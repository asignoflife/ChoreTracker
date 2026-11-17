import { Session } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AuthScreen from '../components/AuthScreen';
import { AppHeader } from '../components/app-header';
import { DatePicker } from '../components/date-picker';
import { combineDateAndTime, formatDateLabel, startOfDay, toDateInput } from '../lib/calendar';
import { supabase } from '../../lib/supabase';

type Profile = {
  id: string;
  full_name: string;
  role: 'parent' | 'kid';
  family_code: string;
  birthday: string | null;
};

type ChoreTemplate = {
  id: number;
  family_code: string;
  title: string;
  default_points: number;
};

type Chore = {
  id: number;
  created_at: string;
  title: string;
  assigned_to: string;
  assigned_to_id: string | null;
  points: number;
  base_points: number | null;
  due_at: string | null;
  submitted_at: string | null;
  is_completed: boolean;
  status: 'pending' | 'submitted' | 'approved' | 'denied';
  before_photo_url: string | null;
  after_photo_url: string | null;
};

type Reward = {
  id: number;
  family_code: string;
  title: string;
  point_cost: number;
};

type Redemption = {
  id: number;
  created_at: string;
  family_code: string;
  kid_id: string;
  kid_name: string;
  reward_title: string;
  points_spent: number;
  status: 'pending' | 'fulfilled';
};

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kids, setKids] = useState<Profile[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [memberToRemove, setMemberToRemove] = useState<Profile | null>(null);
  const [birthdayMemberId, setBirthdayMemberId] = useState<string | null>(null);
  const [birthdayBusy, setBirthdayBusy] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);
  const [choreError, setChoreError] = useState(false);
  const [redemptionError, setRedemptionError] = useState(false);
  const { section: sectionParam } = useLocalSearchParams<{ section?: string }>();
  const section = ['chores', 'prizes', 'setup'].includes(sectionParam ?? '') ? sectionParam : 'dashboard';
  const [templates, setTemplates] = useState<ChoreTemplate[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  // Page / Tab navigation
  const [chorePage, setChorePage] = useState<'todo' | 'needs_approval' | 'approved'>('todo');
  const [parentPanel, setParentPanel] = useState<'new_template' | 'prizes' | 'invite' | 'members' | 'defaults'>('invite');
  const [operationError, setOperationError] = useState('');
  const [inviteRole, setInviteRole] = useState<'parent' | 'kid'>('kid');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Parent chore assignment states
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [pointsInput, setPointsInput] = useState('10');
  const [dueDate, setDueDate] = useState(() => startOfDay(new Date()));
  const [dueTime, setDueTime] = useState('18:00');
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedKidId, setSelectedKidId] = useState<string>('');

  // New chore template states
  const [newTemplateTitle, setNewTemplateTitle] = useState('');
  const [newTemplatePoints, setNewTemplatePoints] = useState('15');

  // New prize states
  const [newRewardTitle, setNewRewardTitle] = useState('');
  const [newRewardCost, setNewRewardCost] = useState('25');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadUserData(session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        loadUserData(session.user.id);
      }
      else {
        setProfile(null);
        setChores([]);
        setKids([]);
        setMembers([]);
        setTemplates([]);
        setRewards([]);
        setRedemptions([]);
        setMemberToRemove(null);
        setMemberError('');
        setOperationError('');
        setInviteCode('');
        setInviteError('');
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadUserData(userId: string) {
    setLoading(true);
    const { data: userProfile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !userProfile) {
      setLoading(false);
      return;
    }

    setProfile(userProfile);

    if (userProfile.role === 'parent') {
      await fetchMembers(userProfile.family_code);

      await fetchTemplates(userProfile.family_code);
    }

    await Promise.all([
      fetchChores(userProfile),
      fetchRewards(userProfile.family_code),
      fetchRedemptions(userProfile),
    ]);

    setLoading(false);
  }

  async function fetchMembers(familyCode: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('family_code', familyCode).order('full_name');
    if (error) { setMemberError('Could not load family members.'); return; }
    const familyMembers = (data ?? []) as Profile[];
    const familyKids = familyMembers.filter((person) => person.role === 'kid');
    setMembers(familyMembers);
    setKids(familyKids);
    setSelectedKidId((previous) => familyKids.some((kid) => kid.id === previous) ? previous : (familyKids[0]?.id ?? ''));
    setMemberError('');
  }

  async function handleRemoveMember(member: Profile) {
    if (!profile) return;
    setMemberBusy(true);
    setMemberError('');
    const { error } = await supabase.rpc('remove_family_member', { member_id: member.id });
    if (error) {
      setMemberError(error.code === 'PGRST202' || error.code === '42883' ? 'Member removal requires the family setup database update.' : error.message);
    } else {
      setMemberToRemove(null);
      setInviteCode('');
      await Promise.all([fetchMembers(profile.family_code), fetchChores(profile), fetchRedemptions(profile)]);
    }
    setMemberBusy(false);
  }

  async function handleSetBirthday(member: Profile, date: Date | null) {
    if (!profile) return;
    setBirthdayBusy(true);
    setMemberError('');
    const { error } = await supabase.rpc('set_family_birthday', {
      member_id: member.id,
      birthday: date ? toDateInput(date) : null,
    });
    if (error) {
      setMemberError(
        ['PGRST202', 'PGRST205'].includes(error.code ?? '')
          ? 'Birthdays need the family calendar birthday update applied first.'
          : error.message
      );
    }
    setBirthdayBusy(false);
    if (!error) {
      setBirthdayMemberId(null);
      await fetchMembers(profile.family_code);
    }
  }

  async function fetchTemplates(familyCode: string) {
    const { data } = await supabase
      .from('chore_templates')
      .select('*')
      .eq('family_code', familyCode)
      .order('id', { ascending: true });

    if (data) {
      setTemplates(data);
      if (data.length > 0) {
        setSelectedTemplateId(data[0].id);
        setPointsInput(data[0].default_points.toString());
      }
    }
  }

  async function fetchChores(currentProfile: Profile) {
    let query = supabase
      .from('chores')
      .select('*')
      .eq('family_code', currentProfile.family_code)
      .order('id', { ascending: false });

    if (currentProfile.role === 'kid') {
      query = query.eq('assigned_to_id', currentProfile.id);
    }

    const { data, error } = await query;
    setChoreError(!!error);
    if (data) setChores(data);
  }

  async function fetchRewards(familyCode: string) {
    const { data } = await supabase
      .from('rewards')
      .select('*')
      .eq('family_code', familyCode)
      .order('point_cost', { ascending: true });

    if (data) setRewards(data);
  }

  async function fetchRedemptions(currentProfile: Profile) {
    let query = supabase
      .from('redemptions')
      .select('*')
      .eq('family_code', currentProfile.family_code)
      .order('id', { ascending: false });

    if (currentProfile.role === 'kid') {
      query = query.eq('kid_id', currentProfile.id);
    }

    const { data, error } = await query;
    setRedemptionError(!!error);
    if (data) setRedemptions(data);
  }

  // A chore earns its full value when finished by the due time, and half
  // when finished after it. The database applies the same rule on approval.
  function choreFullPoints(chore: Chore) {
    return chore.base_points ?? chore.points;
  }

  function choreFinishedLate(chore: Chore) {
    if (!chore.due_at || !chore.submitted_at) return false;
    return new Date(chore.submitted_at).getTime() > new Date(chore.due_at).getTime();
  }

  function formatChoreDue(chore: Chore) {
    if (!chore.due_at) return null;
    const due = new Date(chore.due_at);
    if (Number.isNaN(due.getTime())) return null;
    return due.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatAssignedDate(dateString?: string) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // Only APPROVED chores count toward a kid's earned points
  const earnedPoints = chores
    .filter((c) => c.status === 'approved')
    .reduce((sum, c) => sum + c.points, 0);

  const spentPoints = redemptions.reduce((sum, r) => sum + r.points_spent, 0);
  const availablePoints = Math.max(0, earnedPoints - spentPoints);

  async function handleCreateInvitation() {
    setInviteCode('');
    setInviteError('');
    setInviteLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_family_invitation', { invited_role: inviteRole });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('Could not create an invitation.');
      setInviteCode(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create an invitation. Please try again.';
      setInviteError(message);
    } finally {
      setInviteLoading(false);
    }
  }

  function handleSelectTemplate(template: ChoreTemplate) {
    setSelectedTemplateId(template.id);
    setPointsInput(template.default_points.toString());
  }

  async function handleUpdateDefaultPoints() {
    if (!profile || !selectedTemplateId) return;
    const parsedPoints = Number(pointsInput);
    if (!pointsInput.trim() || !Number.isInteger(parsedPoints) || parsedPoints < 0) {
      setOperationError('Enter a valid non-negative point value.');
      return;
    }

    const { error } = await supabase
      .from('chore_templates')
      .update({ default_points: parsedPoints })
      .eq('id', selectedTemplateId);

    if (error) { setOperationError(error.message); return; }
    setOperationError('');
    setTemplates((prev) =>
      prev.map((t) => (t.id === selectedTemplateId ? { ...t, default_points: parsedPoints } : t))
    );
  }

  async function handleCreateTemplate() {
    if (!profile || !newTemplateTitle.trim()) {
      setOperationError('Enter a chore name to add to the list.');
      return;
    }

    const parsedPoints = Number(newTemplatePoints);
    if (!newTemplatePoints.trim() || !Number.isInteger(parsedPoints) || parsedPoints < 0) { setOperationError('Enter a valid non-negative point value.'); return; }

    const { data, error } = await supabase
      .from('chore_templates')
      .insert({
        family_code: profile.family_code,
        title: newTemplateTitle.trim(),
        default_points: parsedPoints,
      })
      .select()
      .single();

    if (!error && data) {
      setTemplates((prev) => [...prev, data]);
      setSelectedTemplateId(data.id);
      setPointsInput(data.default_points.toString());
      setNewTemplateTitle('');
      setNewTemplatePoints('15');
      setParentPanel('new_template');
      setOperationError('');
    } else if (error) setOperationError(error.message);
  }

  async function handleAssignChore() {
    if (!profile) return;
    const chosenTemplate = templates.find((t) => t.id === selectedTemplateId);
    const chosenKid = kids.find((k) => k.id === selectedKidId);

    if (!chosenTemplate || !chosenKid) {
      setOperationError('Select both a chore and a kid first.');
      return;
    }

    const assignedPoints = Number(pointsInput);
    if (!pointsInput.trim() || !Number.isInteger(assignedPoints) || assignedPoints < 0) { setOperationError('Enter a valid non-negative point value.'); return; }

    const dueAt = combineDateAndTime(dueDate, dueTime);
    if (!dueAt) { setOperationError('Enter the due time as HH:MM, for example 18:00.'); return; }

    const { error } = await supabase.from('chores').insert({
      title: chosenTemplate.title,
      assigned_to: chosenKid.full_name,
      assigned_to_id: chosenKid.id,
      family_code: profile.family_code,
      points: assignedPoints,
      due_at: dueAt.toISOString(),
      is_completed: false,
      status: 'pending',
    });

    if (!error) {
      fetchChores(profile);
      setChorePage('todo');
      setOperationError('');
      setAssignOpen(false);
      router.push({
        pathname: '/chore-assigned',
        params: {
          chore: chosenTemplate.title,
          kid: chosenKid.full_name,
          points: String(assignedPoints),
          due: dueAt.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        },
      });
    } else if (error.code === 'PGRST204') {
      setOperationError('Due dates need the chore due date database update applied first.');
    } else setOperationError(error.message);
  }

  // Kid submits completed chore for parent approval
  async function handleSubmitForApproval(chore: Chore) {
    if (!profile) return;
    const { error } = await supabase
      .from('chores')
      .update({
        is_completed: true,
        status: 'submitted',
      })
      .eq('id', chore.id);

    if (!error) fetchChores(profile);
  }

  // Kid withdraws submission back to To-Do before approval
  async function handleUndoSubmit(chore: Chore) {
    if (!profile) return;
    const { error } = await supabase
      .from('chores')
      .update({
        is_completed: false,
        status: 'pending',
      })
      .eq('id', chore.id);

    if (!error) fetchChores(profile);
  }

  // Parent approves chore -> awards points & moves to Approved page
  async function handleApproveChore(chore: Chore) {
    if (!profile) return;
    const { error } = await supabase
      .from('chores')
      .update({
        is_completed: true,
        status: 'approved',
      })
      .eq('id', chore.id);

    if (!error) fetchChores(profile);
  }

  // Parent denies chore -> removes from Needs Approval & To-Do without awarding points
  async function handleDenyChore(chore: Chore) {
    if (!profile) return;
    const { error } = await supabase
      .from('chores')
      .update({
        is_completed: false,
        status: 'denied',
      })
      .eq('id', chore.id);

    if (!error) fetchChores(profile);
  }

  async function handleCreateReward() {
    if (!profile || !newRewardTitle.trim()) {
      setOperationError('Enter a prize title first.');
      return;
    }
    const cost = Number(newRewardCost);
    if (!newRewardCost.trim() || !Number.isInteger(cost) || cost < 0) { setOperationError('Enter a valid non-negative prize cost.'); return; }

    const { error } = await supabase.from('rewards').insert({
      family_code: profile.family_code,
      title: newRewardTitle.trim(),
      point_cost: cost,
    });

    if (!error) {
      setNewRewardTitle('');
      setNewRewardCost('25');
      fetchRewards(profile.family_code);
      setOperationError('');
    } else setOperationError(error.message);
  }

  async function handleFulfillRedemption(redemptionId: number) {
    if (!profile) return;
    const { error } = await supabase
      .from('redemptions')
      .update({ status: 'fulfilled' })
      .eq('id', redemptionId);

    if (!error) fetchRedemptions(profile);
  }

  async function handleRedeemReward(reward: Reward) {
    if (!profile) return;
    if (availablePoints < reward.point_cost) {
      Alert.alert(
        'Not enough points',
        `You need ${reward.point_cost - availablePoints} more points for this prize!`
      );
      return;
    }

    const { error } = await supabase.from('redemptions').insert({
      family_code: profile.family_code,
      kid_id: profile.id,
      kid_name: profile.full_name,
      reward_title: reward.title,
      points_spent: reward.point_cost,
      status: 'pending',
    });

    if (!error) {
      Alert.alert('Prize Claimed!', `You redeemed "${reward.title}" for ${reward.point_cost} pts!`);
      fetchRedemptions(profile);
    }
  }

  async function handlePhotoUpload(choreId: number, type: 'before' | 'after') {
    if (!profile) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.6,
    });

    if (result.canceled || !result.assets[0]) return;

    try {
      setUploadingId(choreId);
      const photo = result.assets[0];
      const fileExt = photo.uri.split('.').pop() || 'jpg';
      const fileName = `chore-${choreId}-${type}-${Date.now()}.${fileExt}`;

      const response = await fetch(photo.uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('chore-photos')
        .upload(fileName, arrayBuffer, {
          contentType: photo.mimeType || 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('chore-photos')
        .getPublicUrl(fileName);

      const columnToUpdate = type === 'before' ? 'before_photo_url' : 'after_photo_url';

      await supabase
        .from('chores')
        .update({ [columnToUpdate]: urlData.publicUrl })
        .eq('id', choreId);

      await fetchChores(profile);
    } catch (error: any) {
      Alert.alert('Upload failed', error.message);
    } finally {
      setUploadingId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2A9D8F" />
      </SafeAreaView>
    );
  }

  if (!session || !profile) {
    return <AuthScreen onSignedIn={() => router.replace('/')} />;
  }

  const pendingClaimsCount = redemptions.filter((r) => r.status === 'pending').length;

  // Strict 3-page filtering:
  // 1. To Do: ONLY untouched pending chores (excludes approved, denied, and submitted)
  const todoChores = chores.filter((c) => {
    const status = c.status || (c.is_completed ? 'approved' : 'pending');
    return status === 'pending' && !c.is_completed;
  });

  // 2. Needs Approval: ONLY chores marked done by kid waiting for review
  const needsApprovalChores = chores.filter((c) => c.status === 'submitted');

  // 3. Approved: ONLY chores approved by a parent
  const approvedChores = chores.filter((c) => {
    const status = c.status || (c.is_completed ? 'approved' : 'pending');
    return status === 'approved';
  });

  const displayedChores =
    chorePage === 'todo'
      ? todoChores
      : chorePage === 'needs_approval'
      ? needsApprovalChores
      : approvedChores;

  const dashboardHeader = (
    <>
      <AppHeader
        fullName={profile.full_name}
        role={profile.role}
        section={section === 'chores' || section === 'prizes' || section === 'setup' ? section : 'dashboard'}
      />

      {section === 'dashboard' && (
        <>
          {(choreError || redemptionError) && <Text style={styles.inviteError}>Some dashboard information could not be loaded. Check your connection and try again.</Text>}
          <View style={styles.overviewHero}>
            <View style={styles.overviewHeroBody}>
              <Text style={styles.heroEyebrow}>{profile.role === 'parent' ? 'YOUR HOUSEHOLD AT A GLANCE' : 'YOUR CHORES AT A GLANCE'}</Text>
              <Text style={styles.heroNumber}>{choreError ? '—' : todoChores.length}</Text>
              <Text style={styles.heroTitle}>{profile.role === 'parent' ? 'chores left to do' : 'chores on your list'}</Text>
              <Text style={styles.heroCaption}>{profile.role === 'parent' ? 'A little teamwork goes a long way.' : 'Ready when you are.'}</Text>
              <Link href="/?section=chores" asChild><TouchableOpacity style={styles.heroButton}><Text style={styles.heroButtonText}>View chore board  →</Text></TouchableOpacity></Link>
            </View>
            <View style={styles.heroIllustration}><Text style={styles.heroIllustrationText}>✓</Text></View>
          </View>
          <Text style={styles.overviewHeading}>The important stuff</Text>
          <View style={styles.overviewStats}>
            <View style={styles.overviewStat}><Text style={styles.overviewStatLabel}>NEEDS APPROVAL</Text><Text style={styles.overviewStatValue}>{choreError ? '—' : needsApprovalChores.length}</Text><Text style={styles.overviewStatCaption}>Chores waiting for review</Text></View>
            <View style={styles.overviewStat}><Text style={styles.overviewStatLabel}>APPROVED CHORES</Text><Text style={styles.overviewStatValue}>{choreError ? '—' : approvedChores.length}</Text><Text style={styles.overviewStatCaption}>A job well done</Text></View>
            <View style={styles.overviewStat}><Text style={styles.overviewStatLabel}>{profile.role === 'parent' ? 'PRIZES TO GIVE' : 'YOUR POINTS'}</Text><Text style={styles.overviewStatValue}>{redemptionError || (profile.role === 'kid' && choreError) ? '—' : profile.role === 'parent' ? pendingClaimsCount : availablePoints}</Text><Text style={styles.overviewStatCaption}>{profile.role === 'parent' ? 'Claimed prizes waiting' : 'Available to spend'}</Text></View>
          </View>
          <Text style={styles.overviewHeading}>Where to next?</Text>
          <View style={styles.quickLinks}>
            <Link href="/?section=chores" asChild><TouchableOpacity style={styles.quickLink}><Text style={styles.quickLinkIcon}>✓</Text><Text style={styles.quickLinkTitle}>Chores  →</Text><Text style={styles.quickLinkDescription}>{profile.role === 'parent' ? 'Assign and review chores' : 'See your chore list'}</Text></TouchableOpacity></Link>
            <Link href="/?section=prizes" asChild><TouchableOpacity style={styles.quickLink}><Text style={styles.quickLinkIcon}>✦</Text><Text style={styles.quickLinkTitle}>Prizes  →</Text><Text style={styles.quickLinkDescription}>{profile.role === 'parent' ? 'Manage prize claims' : 'Spend your points'}</Text></TouchableOpacity></Link>
            <Link href="/family-stats" asChild><TouchableOpacity style={styles.quickLink}><Text style={styles.quickLinkIcon}>↗</Text><Text style={styles.quickLinkTitle}>{profile.role === 'parent' ? 'Child stats' : 'Leaderboard'}  →</Text><Text style={styles.quickLinkDescription}>See everyone’s progress</Text></TouchableOpacity></Link>
            {profile.role === 'parent' && <Link href="/?section=setup" asChild><TouchableOpacity style={styles.quickLink}><Text style={styles.quickLinkIcon}>⚙</Text><Text style={styles.quickLinkTitle}>Family setup  →</Text><Text style={styles.quickLinkDescription}>People, chores &amp; prizes</Text></TouchableOpacity></Link>}
          </View>
        </>
      )}

      {profile.role === 'parent' && section !== 'dashboard' && (section === 'chores' && !assignOpen ? (
        <TouchableOpacity style={styles.assignPrompt} onPress={() => setAssignOpen(true)}>
          <Text style={styles.assignPromptPlus}>+</Text>
          <Text style={styles.assignPromptText}>Assign a chore</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.assignBox}>
          <View style={styles.sectionHeading}><View><Text style={styles.sectionKicker}>{section === 'setup' ? 'FAMILY SETTINGS' : section === 'chores' ? 'ASSIGN A CHORE' : 'PRIZE CLAIMS'}</Text><Text style={styles.sectionTitle}>{section === 'setup' ? 'Make it yours' : section === 'chores' ? 'Give someone a task' : 'Claimed prizes'}</Text></View></View>
          {section === 'setup' && <View style={styles.tabRow}>
            {([
              ['invite', 'Invite'], ['members', 'Members'], ['new_template', 'Chores'], ['defaults', 'Default points'], ['prizes', 'Prizes'],
            ] as const).map(([key, label]) => <TouchableOpacity key={key} style={[styles.tabBtn, parentPanel === key && styles.tabBtnActive]} onPress={() => { setParentPanel(key); setOperationError(''); }}><Text style={[styles.tabText, parentPanel === key && styles.tabTextActive]}>{label}</Text></TouchableOpacity>)}
          </View>}
          {!!operationError && <Text style={styles.inviteError}>{operationError}</Text>}

          {section === 'setup' && parentPanel === 'invite' && (
            <View>
              <Text style={styles.label}>Invite a family member as:</Text>
              <View style={styles.kidPicker}>
                {(['kid', 'parent'] as const).map((role) => (
                  <TouchableOpacity
                    key={role}
                    style={[styles.kidChip, inviteRole === role && styles.kidChipActive]}
                    onPress={() => { setInviteRole(role); setInviteCode(''); setInviteError(''); }}
                  >
                    <Text style={[styles.kidChipText, inviteRole === role && styles.kidChipTextActive]}>{role === 'kid' ? 'Kid' : 'Parent'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.inviteHelp}>The code is single-use, expires after 7 days, and grants the selected role to whoever has it. Share it privately.</Text>
              <TouchableOpacity style={styles.addBtn} onPress={handleCreateInvitation} disabled={inviteLoading}>
                {inviteLoading ? <ActivityIndicator color="#0C2127" /> : <Text style={styles.addBtnText}>Create {inviteRole === 'kid' ? 'kid' : 'parent'} invitation</Text>}
              </TouchableOpacity>
              {!!inviteError && <Text style={styles.inviteError}>{inviteError}</Text>}
              {!!inviteCode && (
                <View>
                  <Text style={styles.label}>Share this invitation code:</Text>
                  <Text selectable style={styles.inviteCode}>{inviteCode}</Text>
                  <Text style={styles.inviteHelp}>They can enter it under “I have an invitation” on the sign-in screen.</Text>
                </View>
              )}
            </View>
          )}

          {section === 'setup' && parentPanel === 'members' && (
            <View>
              <Text style={styles.inviteHelp}>Removing someone separates their account from this family. Their old chores and prize history remain here. They can no longer access this family; rejoining with that account requires administrator help.</Text>
              {!!memberError && <Text style={styles.inviteError}>{memberError}</Text>}
              {members.map((member) => (
                <View key={member.id} style={styles.memberCard}>
                  <View style={styles.memberRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.claimTitle}>{member.full_name}{member.id === profile.id ? ' (you)' : ''}</Text>
                      <Text style={styles.claimSub}>{member.role === 'parent' ? 'Parent' : 'Kid'}</Text>
                      <Text style={styles.claimSub}>
                        {member.birthday
                          ? `Birthday: ${formatDateLabel(new Date(`${member.birthday}T00:00:00`))}`
                          : 'No birthday set'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.birthdayBtn}
                      onPress={() => setBirthdayMemberId((current) => (current === member.id ? null : member.id))}>
                      <Text style={styles.birthdayBtnText}>{member.birthday ? 'Change' : 'Set birthday'}</Text>
                    </TouchableOpacity>
                    {member.id !== profile.id && (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => { setMemberToRemove(member); setMemberError(''); }}>
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {birthdayMemberId === member.id && (
                    <View>
                      <DatePicker
                        label={`${member.full_name}’s birthday`}
                        value={member.birthday ? new Date(`${member.birthday}T00:00:00`) : null}
                        onChange={(date) => handleSetBirthday(member, date)}
                        onClear={member.birthday ? () => handleSetBirthday(member, null) : undefined}
                      />
                      {birthdayBusy && <Text style={styles.inviteHelp}>Saving…</Text>}
                      <Text style={styles.inviteHelp}>Birthdays appear in the family calendar every year.</Text>
                    </View>
                  )}
                </View>
              ))}
              {memberToRemove && <View style={styles.confirmBox}>
                <Text style={styles.claimTitle}>Remove {memberToRemove.full_name} from your family?</Text>
                <Text style={styles.inviteHelp}>All unused family invitations will be revoked. This does not delete their account.</Text>
                <View style={styles.pointsRow}><TouchableOpacity disabled={memberBusy} style={styles.removeBtn} onPress={() => handleRemoveMember(memberToRemove)}><Text style={styles.removeBtnText}>{memberBusy ? 'Removing…' : 'Yes, remove'}</Text></TouchableOpacity><TouchableOpacity disabled={memberBusy} style={styles.saveDefaultBtn} onPress={() => setMemberToRemove(null)}><Text style={styles.saveDefaultText}>Cancel</Text></TouchableOpacity></View>
              </View>}
            </View>
          )}

          {section === 'setup' && parentPanel === 'defaults' && <View>
            <Text style={styles.inviteHelp}>Choose a chore and set the points used when assigning it.</Text>
            <View style={styles.templateWrap}>{templates.map((tpl) => <TouchableOpacity key={tpl.id} style={[styles.templateChip, tpl.id === selectedTemplateId && styles.templateChipActive]} onPress={() => handleSelectTemplate(tpl)}><Text style={[styles.templateChipText, tpl.id === selectedTemplateId && styles.templateChipTextActive]}>{tpl.title} ({tpl.default_points} pts)</Text></TouchableOpacity>)}</View>
            {templates.length === 0 && <Text style={styles.inviteHelp}>Add a chore first.</Text>}
            <Text style={styles.label}>Default points</Text><View style={styles.pointsRow}><TextInput style={[styles.input, { width: 85, marginBottom: 0 }]} keyboardType="numeric" value={pointsInput} onChangeText={setPointsInput} /><TouchableOpacity style={styles.saveDefaultBtn} disabled={!selectedTemplateId} onPress={handleUpdateDefaultPoints}><Text style={styles.saveDefaultText}>Save default</Text></TouchableOpacity></View>
          </View>}

          {section === 'chores' && (
            <>
              {(templates.length === 0 || kids.length === 0) && <Text style={styles.inviteHelp}>Add chores and invite kids in Family setup before assigning a chore.</Text>}
              <Text style={styles.label}>1. Select a Chore:</Text>
              <View style={styles.templateWrap}>
                {templates.map((tpl) => {
                  const isSelected = tpl.id === selectedTemplateId;
                  return (
                    <TouchableOpacity
                      key={tpl.id}
                      style={[styles.templateChip, isSelected && styles.templateChipActive]}
                      onPress={() => handleSelectTemplate(tpl)}
                    >
                      <Text
                        style={[
                          styles.templateChipText,
                          isSelected && styles.templateChipTextActive,
                        ]}
                      >
                        {tpl.title} ({tpl.default_points}p)
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>2. Points Awarded:</Text>
              <View style={styles.pointsRow}>
                <TextInput
                  style={[styles.input, { width: 85, marginBottom: 0 }]}
                  keyboardType="numeric"
                  value={pointsInput}
                  onChangeText={setPointsInput}
                />

              </View>

              <Text style={styles.label}>3. Assign To:</Text>
              <View style={styles.kidPicker}>
                {kids.map((kid) => (
                  <TouchableOpacity
                    key={kid.id}
                    style={[styles.kidChip, selectedKidId === kid.id && styles.kidChipActive]}
                    onPress={() => setSelectedKidId(kid.id)}
                  >
                    <Text
                      style={[
                        styles.kidChipText,
                        selectedKidId === kid.id && styles.kidChipTextActive,
                      ]}
                    >
                      {kid.full_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>4. Due Date &amp; Time:</Text>
              <DatePicker
                label="Due date"
                value={dueDate}
                onChange={setDueDate}
                minimum={startOfDay(new Date())}
              />
              <Text style={styles.label}>Due time (24-hour)</Text>
              <TextInput
                style={styles.input}
                placeholder="18:00"
                placeholderTextColor="#7E979E"
                value={dueTime}
                onChangeText={setDueTime}
              />
              <Text style={styles.inviteHelp}>Chores finished after the due time earn half points.</Text>

              <TouchableOpacity style={styles.addBtn} onPress={handleAssignChore}>
                <Text style={styles.addBtnText}>Assign Chore</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.hideAssignBtn}
                onPress={() => { setAssignOpen(false); setOperationError(''); }}>
                <Text style={styles.hideAssignText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {section === 'setup' && parentPanel === 'new_template' && (
            <>
              <Text style={styles.label}>New Chore Name:</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Vacuum living room"
                value={newTemplateTitle}
                onChangeText={setNewTemplateTitle}
              />
              <Text style={styles.label}>Default Points:</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., 20"
                keyboardType="numeric"
                value={newTemplatePoints}
                onChangeText={setNewTemplatePoints}
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleCreateTemplate}>
                <Text style={styles.addBtnText}>Save to Chore List</Text>
              </TouchableOpacity>
              <Text style={styles.label}>Your chores</Text>
              <View style={styles.templateWrap}>{templates.map((tpl) => <View key={tpl.id} style={styles.rewardTag}><Text style={styles.rewardTagText}>{tpl.title} · {tpl.default_points} pts</Text></View>)}</View>
            </>
          )}

          {section === 'setup' && parentPanel === 'prizes' && (
            <View>
              <Text style={styles.label}>Add a New Prize for Kids:</Text>
              <View style={styles.pointsRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="Prize (e.g., Ice Cream Trip)"
                  value={newRewardTitle}
                  onChangeText={setNewRewardTitle}
                />
                <TextInput
                  style={[styles.input, { width: 75, marginBottom: 0 }]}
                  placeholder="Pts"
                  keyboardType="numeric"
                  value={newRewardCost}
                  onChangeText={setNewRewardCost}
                />
                <TouchableOpacity style={styles.smallAddBtn} onPress={handleCreateReward}>
                  <Text style={styles.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Active Prizes:</Text>
              <View style={styles.templateWrap}>
                {rewards.map((r) => (
                  <View key={r.id} style={styles.rewardTag}>
                    <Text style={styles.rewardTagText}>
                      🎁 {r.title} ({r.point_cost} pts)
                    </Text>
                  </View>
                ))}
              </View>

            </View>
          )}
          {section === 'prizes' && (
            <View>
              {redemptions.length === 0 && <Text style={styles.inviteHelp}>No prizes have been claimed yet.</Text>}
              {redemptions.length > 0 && (
                <>
                  <Text style={styles.label}>Claimed Prizes:</Text>
                  {redemptions.map((claim) => (
                    <View key={claim.id} style={styles.claimRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.claimTitle}>
                          {claim.kid_name} claimed &quot;{claim.reward_title}&quot;
                        </Text>
                        <Text style={styles.claimSub}>
                          -{claim.points_spent} pts •{' '}
                          {claim.status === 'fulfilled' ? '✅ Given' : '⏳ Waiting for parent'}
                        </Text>
                      </View>
                      {claim.status === 'pending' && (
                        <TouchableOpacity
                          style={styles.fulfillBtn}
                          onPress={() => handleFulfillRedemption(claim.id)}
                        >
                          <Text style={styles.fulfillBtnText}>Mark Given</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </View>
      ))}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      {section === 'dashboard' || section === 'setup' || (section === 'prizes' && profile.role === 'parent') ? (
        <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">{dashboardHeader}{section === 'setup' && profile.role !== 'parent' && <Text style={styles.inviteHelp}>Family setup is available to parents.</Text>}</ScrollView>
      ) : profile.role === 'kid' && section === 'prizes' ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<>{dashboardHeader}<Text style={styles.listHeading}>The prize shelf</Text><Text style={styles.listDescription}>A little something to work towards.</Text></>}
          data={rewards}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={<Text style={styles.emptyText}>No prizes added by parents yet!</Text>}
          renderItem={({ item }) => {
            const canAfford = availablePoints >= item.point_cost;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>🎁 {item.title}</Text>
                    <Text style={styles.subtitle}>Cost: {item.point_cost} points</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.redeemBtn, !canAfford && styles.redeemBtnDisabled]}
                    onPress={() => handleRedeemReward(item)}
                  >
                    <Text style={styles.redeemBtnText}>
                      {canAfford ? 'Redeem' : `Need ${item.point_cost - availablePoints} more`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      ) : (
        /* ==================== 3-PAGE CHORE VIEW ==================== */
        <FlatList
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {dashboardHeader}
              <View style={styles.listHeadingRow}>
                <View>
                  <Text style={styles.listHeading}>The chore board</Text>
                  <Text style={styles.listDescription}>Everything your family is working on.</Text>
                </View>
              </View>
          <View style={styles.pageBar}>
            <TouchableOpacity
              style={[styles.pageTab, chorePage === 'todo' && styles.pageTabActive]}
              onPress={() => setChorePage('todo')}
            >
              <Text style={[styles.pageTabText, chorePage === 'todo' && styles.pageTabTextActive]}>
                To Do ({todoChores.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.pageTab,
                chorePage === 'needs_approval' && styles.pageTabApprovalActive,
              ]}
              onPress={() => setChorePage('needs_approval')}
            >
              <Text
                style={[
                  styles.pageTabText,
                  chorePage === 'needs_approval' && styles.pageTabTextActive,
                ]}
              >
                Needs Approval ({needsApprovalChores.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.pageTab, chorePage === 'approved' && styles.pageTabApprovedActive]}
              onPress={() => setChorePage('approved')}
            >
              <Text
                style={[styles.pageTabText, chorePage === 'approved' && styles.pageTabTextActive]}
              >
                Approved ({approvedChores.length})
              </Text>
            </TouchableOpacity>
          </View>
            </>
          }
            data={displayedChores}
            keyExtractor={(item) => item.id.toString()}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {chorePage === 'todo'
                  ? 'No chores left to do!'
                  : chorePage === 'needs_approval'
                  ? 'No chores waiting for approval.'
                  : 'No approved chores yet.'}
              </Text>
            }
            renderItem={({ item }) => {
              const isSubmitted = item.status === 'submitted';
              const isApproved = item.status === 'approved';
              const dueLabel = formatChoreDue(item);
              const finishedLate = choreFinishedLate(item);
              const fullPoints = choreFullPoints(item);
              const expectedPoints = finishedLate ? Math.floor(fullPoints / 2) : fullPoints;

              return (
                <View style={[styles.card, isSubmitted && styles.submittedCard]}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.title, isApproved && styles.completedText]}>
                        {item.title}
                      </Text>
                      <Text style={styles.subtitle}>
                        Assigned to: {item.assigned_to} • 📅 {formatAssignedDate(item.created_at)}
                      </Text>
                      {!!dueLabel && (
                        <View style={styles.dueRow}>
                          <Text style={styles.dueText}>Due {dueLabel}</Text>
                          {finishedLate && <Text style={styles.lateTag}>Late · half points</Text>}
                        </View>
                      )}
                    </View>
                    <View style={styles.badge}>
                      <Text style={styles.points}>{isApproved ? item.points : fullPoints} pts</Text>
                    </View>
                  </View>

                  {/* Before & After Photos */}
                  <View style={styles.photoRow}>
                    <TouchableOpacity
                      style={styles.photoBox}
                      disabled={profile.role === 'parent' || uploadingId === item.id || isApproved}
                      onPress={() => handlePhotoUpload(item.id, 'before')}
                    >
                      {item.before_photo_url ? (
                        <Image source={{ uri: item.before_photo_url }} style={styles.thumbnail} />
                      ) : (
                        <Text style={styles.photoPlaceholder}>
                          {profile.role === 'kid' && !isApproved
                            ? '+ Before Photo'
                            : 'No Before Photo'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.photoBox}
                      disabled={profile.role === 'parent' || uploadingId === item.id || isApproved}
                      onPress={() => handlePhotoUpload(item.id, 'after')}
                    >
                      {item.after_photo_url ? (
                        <Image source={{ uri: item.after_photo_url }} style={styles.thumbnail} />
                      ) : (
                        <Text style={styles.photoPlaceholder}>
                          {profile.role === 'kid' && !isApproved
                            ? '+ After Photo'
                            : 'No After Photo'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {uploadingId === item.id && (
                    <Text style={styles.uploadingText}>Uploading photo...</Text>
                  )}

                  {/* ==================== PAGE 1: TO DO ACTIONS ==================== */}
                  {chorePage === 'todo' && profile.role === 'kid' && (
                    <TouchableOpacity
                      style={styles.completeBtn}
                      onPress={() => handleSubmitForApproval(item)}
                    >
                      <Text style={styles.completeBtnText}>Mark Done (Send for Approval)</Text>
                    </TouchableOpacity>
                  )}

                  {/* ==================== PAGE 2: NEEDS APPROVAL ACTIONS ==================== */}
                  {chorePage === 'needs_approval' && profile.role === 'parent' && (
                    <View style={styles.approvalRow}>
                      <TouchableOpacity
                        style={styles.approveBtn}
                        onPress={() => handleApproveChore(item)}
                      >
                        <Text style={styles.approveBtnText}>
                          ✓ Approve (+{expectedPoints} pts{finishedLate ? ', late' : ''})
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.denyBtn}
                        onPress={() => handleDenyChore(item)}
                      >
                        <Text style={styles.denyBtnText}>✕ Deny</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {chorePage === 'needs_approval' && profile.role === 'kid' && (
                    <TouchableOpacity
                      style={styles.pendingReviewBtn}
                      onPress={() => handleUndoSubmit(item)}
                    >
                      <Text style={styles.pendingReviewText}>
                        ⏳ Waiting for Parent Approval (Tap to Undo)
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* ==================== PAGE 3: APPROVED BADGE ==================== */}
                  {chorePage === 'approved' && (
                    <View style={styles.approvedFooter}>
                      <Text style={styles.approvedFooterText}>
                        {finishedLate
                          ? `✅ Approved • ${item.points} pts awarded (half of ${fullPoints}, finished late)`
                          : `✅ Approved • ${item.points} pts awarded`}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#14232A' },
  container: { flex: 1, backgroundColor: '#14232A' },
  listContent: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56, flexGrow: 1 },
  mainNav: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 16 },
  mainNavItem: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  mainNavItemActive: { backgroundColor: '#1B3A3A' },
  mainNavText: { color: '#A9C0C6', fontSize: 13, fontWeight: '700' },
  mainNavTextActive: { color: '#EAF2F2' },
  overviewHero: { backgroundColor: '#0F1E25', borderRadius: 22, padding: 26, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden', gap: 12 },
  overviewHeroBody: { flex: 1 },
  heroEyebrow: { color: '#A8D5CE', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  heroNumber: { color: '#FFFFFF', fontSize: 54, fontWeight: '800', marginTop: 15 },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  heroCaption: { color: '#BFD8D4', fontSize: 13, marginTop: 6 },
  heroButton: { backgroundColor: '#F5FAF9', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 15, alignSelf: 'flex-start', marginTop: 20 },
  heroButtonText: { color: '#14232A', fontSize: 12, fontWeight: '800' },
  heroIllustration: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#2A9D8F', alignItems: 'center', justifyContent: 'center' },
  heroIllustrationText: { color: '#E9C46A', fontSize: 54, fontWeight: '800' },
  overviewHeading: { color: '#EAF2F2', fontSize: 19, fontWeight: '800', marginTop: 30, marginBottom: 14 },
  overviewStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  overviewStat: { flexGrow: 1, flexBasis: 150, backgroundColor: '#1E3139', borderRadius: 16, borderWidth: 1, borderColor: '#2E4750', padding: 17 },
  overviewStatLabel: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  overviewStatValue: { color: '#EAF2F2', fontSize: 30, fontWeight: '800', marginTop: 9 },
  overviewStatCaption: { color: '#A9C0C6', fontSize: 12, marginTop: 4 },
  quickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickLink: { flexGrow: 1, flexBasis: 180, backgroundColor: '#1E3139', borderRadius: 16, borderWidth: 1, borderColor: '#2E4750', padding: 17 },
  quickLinkIcon: { color: '#5FC7BA', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  quickLinkTitle: { color: '#EAF2F2', fontSize: 15, fontWeight: '800' },
  quickLinkDescription: { color: '#A9C0C6', fontSize: 12, marginTop: 5 },
  removeBtn: { backgroundColor: '#3B2724', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9 },
  removeBtnText: { color: '#F08A72', fontSize: 12, fontWeight: '700' },
  assignPrompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 16, paddingVertical: 16, marginBottom: 18 },
  assignPromptPlus: { color: '#5FC7BA', fontSize: 18, fontWeight: '800' },
  assignPromptText: { color: '#EAF2F2', fontSize: 14, fontWeight: '800' },
  hideAssignBtn: { alignItems: 'center', paddingVertical: 12 },
  hideAssignText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  dueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 7 },
  dueText: { color: '#A9C0C6', fontSize: 12 },
  lateTag: { backgroundColor: '#3B2724', color: '#F08A72', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, overflow: 'hidden' },
  confirmBox: { backgroundColor: '#3A3324', padding: 14, borderRadius: 12, marginTop: 12 },
  memberCard: { backgroundColor: '#172A31', borderRadius: 10, padding: 12, marginBottom: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  birthdayBtn: { backgroundColor: '#20343C', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  birthdayBtnText: { color: '#A9C0C6', fontSize: 11, fontWeight: '700' },
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: '#2E4750' },
  brandMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#0F1E25', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  brandMarkText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  brandName: { flex: 1, color: '#EAF2F2', fontSize: 21, fontWeight: '800', letterSpacing: -1 },
  brandAccent: { color: '#E76F51' },
  signOutBtn: { borderWidth: 1, borderColor: '#2E4750', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#1E3139' },
  signOutText: { color: '#EAF2F2', fontWeight: '700', fontSize: 12 },
  topBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingVertical: 30 },
  greeting: { flexGrow: 1, flexShrink: 1 },
  eyebrow: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  header: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1, color: '#EAF2F2' },
  wave: { color: '#F4A261' },
  headerSub: { fontSize: 14, color: '#A9C0C6', marginTop: 5 },
  familyPill: { backgroundColor: '#20343C', borderRadius: 30, paddingHorizontal: 14, paddingVertical: 9 },
  familyTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: '#A9C0C6' },
  pointsBanner: { backgroundColor: '#2A9D8F', padding: 22, borderRadius: 20, marginBottom: 26, flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'space-between', alignItems: 'center' },
  pointsBannerLabel: { color: '#BFD8D4', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  pointsBannerValue: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: 5 },
  kidTabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kidNavBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  kidNavBtnActive: { backgroundColor: '#E9F5F3' },
  kidNavText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  kidNavTextActive: { color: '#5FC7BA' },
  assignBox: { backgroundColor: '#1E3139', padding: 22, borderRadius: 20, marginBottom: 30, borderWidth: 1, borderColor: '#2E4750' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  sectionKicker: { fontSize: 10, letterSpacing: 1.1, fontWeight: '800', color: '#7E979E', marginBottom: 5 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#EAF2F2', letterSpacing: -0.5 },
  statsLink: { backgroundColor: '#1B3A3A', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  statsLinkText: { color: '#5FC7BA', fontSize: 12, fontWeight: '700' },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 17, backgroundColor: '#20343C', borderRadius: 12, padding: 4 },
  tabBtn: { flexGrow: 1, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 9, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#2A9D8F' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#A9C0C6', textAlign: 'center' },
  tabTextActive: { color: '#0C2127' },
  label: { fontSize: 12, fontWeight: '700', color: '#A9C0C6', marginBottom: 8, marginTop: 10 },
  templateWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  templateChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: '#2E4750', backgroundColor: '#172A31' },
  templateChipActive: { backgroundColor: '#1B3A3A', borderColor: '#2A9D8F' },
  templateChipText: { fontSize: 12, color: '#A9C0C6', fontWeight: '600' },
  templateChipTextActive: { color: '#EAF2F2' },
  pointsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 },
  saveDefaultBtn: { backgroundColor: '#20343C', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  saveDefaultText: { fontSize: 12, fontWeight: '700', color: '#EAF2F2' },
  input: { backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 8, color: '#EAF2F2', minHeight: 44 },
  kidPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 },
  kidChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#2E4750' },
  kidChipActive: { backgroundColor: '#2A9D8F', borderColor: '#2A9D8F' },
  kidChipText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  kidChipTextActive: { color: '#0C2127' },
  addBtn: { backgroundColor: '#2A9D8F', padding: 14, borderRadius: 11, alignItems: 'center' },
  smallAddBtn: { backgroundColor: '#2A9D8F', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 10 },
  addBtnText: { color: '#0C2127', fontWeight: '700', fontSize: 13 },
  inviteHelp: { color: '#A9C0C6', fontSize: 12, lineHeight: 19, marginBottom: 12 },
  inviteError: { color: '#F08A72', fontSize: 13, lineHeight: 20, marginTop: 10 },
  inviteCode: { color: '#5FC7BA', backgroundColor: '#22343A', padding: 12, borderRadius: 10, fontSize: 13 },
  listHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listHeading: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: '#EAF2F2' },
  listDescription: { color: '#A9C0C6', fontSize: 13, marginTop: 5, marginBottom: 17 },
  pageBar: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#20343C', padding: 4, borderRadius: 12, marginBottom: 16, gap: 4 },
  pageTab: { flexGrow: 1, paddingHorizontal: 8, paddingVertical: 11, borderRadius: 9, alignItems: 'center' },
  pageTabActive: { backgroundColor: '#2A9D8F' },
  pageTabApprovalActive: { backgroundColor: '#2A9D8F' },
  pageTabApprovedActive: { backgroundColor: '#2A9D8F' },
  pageTabText: { fontSize: 12, fontWeight: '700', color: '#A9C0C6', textAlign: 'center' },
  pageTabTextActive: { color: '#0C2127' },
  rewardTag: { backgroundColor: '#3A3324', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  rewardTagText: { fontSize: 12, fontWeight: '700', color: '#E9C46A' },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#172A31', padding: 12, borderRadius: 10, marginBottom: 6 },
  claimTitle: { fontSize: 13, fontWeight: '700', color: '#EAF2F2' },
  claimSub: { fontSize: 11, color: '#7E979E', marginTop: 4 },
  fulfillBtn: { backgroundColor: '#2A9D8F', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 },
  fulfillBtnText: { color: '#0C2127', fontSize: 12, fontWeight: '700' },
  redeemBtn: { backgroundColor: '#2A9D8F', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, marginLeft: 8 },
  redeemBtnDisabled: { backgroundColor: '#3A4F57' },
  redeemBtnText: { color: '#0C2127', fontWeight: '700', fontSize: 12 },
  card: { backgroundColor: '#1E3139', padding: 18, borderRadius: 17, marginBottom: 12, borderWidth: 1, borderColor: '#2E4750' },
  submittedCard: { borderColor: '#E9C46A' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { fontSize: 16, fontWeight: '800', color: '#EAF2F2' },
  completedText: { color: '#A9C0C6' },
  subtitle: { fontSize: 12, color: '#7E979E', marginTop: 5 },
  badge: { backgroundColor: '#1B3A3A', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 },
  points: { color: '#5FC7BA', fontWeight: '800', fontSize: 12 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBox: { flex: 1, height: 95, borderRadius: 11, borderWidth: 1, borderColor: '#2E4750', borderStyle: 'dashed', backgroundColor: '#172A31', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { fontSize: 12, fontWeight: '600', color: '#7E979E', textAlign: 'center' },
  uploadingText: { fontSize: 12, color: '#5FC7BA', marginTop: 8, textAlign: 'center' },
  completeBtn: { backgroundColor: '#2A9D8F', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  pendingReviewBtn: { backgroundColor: '#F4A261', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  pendingReviewText: { color: '#EAF2F2', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  completeBtnText: { color: '#0C2127', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  approvalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  approveBtn: { flexGrow: 2, backgroundColor: '#2A9D8F', padding: 13, borderRadius: 10, alignItems: 'center' },
  approveBtnText: { color: '#0C2127', fontWeight: '700', fontSize: 13 },
  denyBtn: { flexGrow: 1, backgroundColor: '#3B2724', padding: 13, borderRadius: 10, alignItems: 'center' },
  denyBtnText: { color: '#F08A72', fontWeight: '700', fontSize: 13 },
  approvedFooter: { marginTop: 12, backgroundColor: '#1B3A3A', padding: 10, borderRadius: 10, alignItems: 'center' },
  approvedFooterText: { color: '#5FC7BA', fontWeight: '700', fontSize: 12 },
  emptyText: { textAlign: 'center', color: '#7E979E', marginTop: 20, padding: 26, backgroundColor: '#1E3139', borderRadius: 16, overflow: 'hidden' },
});
