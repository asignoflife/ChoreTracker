import { Session } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AuthScreen from '../components/AuthScreen';
import { supabase } from '../../lib/supabase';

type Profile = {
  id: string;
  full_name: string;
  role: 'parent' | 'kid';
  family_code: string;
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
  const [templates, setTemplates] = useState<ChoreTemplate[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  // Page / Tab navigation
  const [chorePage, setChorePage] = useState<'todo' | 'needs_approval' | 'approved'>('todo');
  const [parentPanel, setParentPanel] = useState<'assign' | 'new_template' | 'prizes'>('assign');
  const [kidSection, setKidSection] = useState<'chores' | 'store'>('chores');

  // Parent chore assignment states
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [pointsInput, setPointsInput] = useState('10');
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
      if (session) loadUserData(session.user.id);
      else {
        setProfile(null);
        setChores([]);
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
      const { data: familyKids } = await supabase
        .from('profiles')
        .select('*')
        .eq('family_code', userProfile.family_code)
        .eq('role', 'kid');

      if (familyKids && familyKids.length > 0) {
        setKids(familyKids);
        setSelectedKidId(familyKids[0].id);
      }

      await fetchTemplates(userProfile.family_code);
    }

    await Promise.all([
      fetchChores(userProfile),
      fetchRewards(userProfile.family_code),
      fetchRedemptions(userProfile),
    ]);

    setLoading(false);
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

    const { data } = await query;
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

    const { data } = await query;
    if (data) setRedemptions(data);
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

  function handleSelectTemplate(template: ChoreTemplate) {
    setSelectedTemplateId(template.id);
    setPointsInput(template.default_points.toString());
  }

  async function handleUpdateDefaultPoints() {
    if (!profile || !selectedTemplateId) return;
    const parsedPoints = parseInt(pointsInput, 10);
    if (isNaN(parsedPoints) || parsedPoints < 0) {
      Alert.alert('Invalid points', 'Please enter a valid number.');
      return;
    }

    const { error } = await supabase
      .from('chore_templates')
      .update({ default_points: parsedPoints })
      .eq('id', selectedTemplateId);

    if (!error) {
      setTemplates((prev) =>
        prev.map((t) => (t.id === selectedTemplateId ? { ...t, default_points: parsedPoints } : t))
      );
      Alert.alert('Saved', `Default points updated to ${parsedPoints} pts!`);
    }
  }

  async function handleCreateTemplate() {
    if (!profile || !newTemplateTitle.trim()) {
      Alert.alert('Missing title', 'Enter a chore name to add to the list.');
      return;
    }

    const parsedPoints = parseInt(newTemplatePoints, 10) || 10;

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
      setParentPanel('assign');
    }
  }

  async function handleAssignChore() {
    if (!profile) return;
    const chosenTemplate = templates.find((t) => t.id === selectedTemplateId);
    const chosenKid = kids.find((k) => k.id === selectedKidId);

    if (!chosenTemplate || !chosenKid) {
      Alert.alert('Missing selection', 'Select both a chore and a kid first.');
      return;
    }

    const assignedPoints = parseInt(pointsInput, 10) || chosenTemplate.default_points;

    const { error } = await supabase.from('chores').insert({
      title: chosenTemplate.title,
      assigned_to: chosenKid.full_name,
      assigned_to_id: chosenKid.id,
      family_code: profile.family_code,
      points: assignedPoints,
      is_completed: false,
      status: 'pending',
    });

    if (!error) {
      fetchChores(profile);
      setChorePage('todo');
    }
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
      Alert.alert('Missing prize name', 'Enter a prize title first.');
      return;
    }
    const cost = parseInt(newRewardCost, 10) || 25;

    const { error } = await supabase.from('rewards').insert({
      family_code: profile.family_code,
      title: newRewardTitle.trim(),
      point_cost: cost,
    });

    if (!error) {
      setNewRewardTitle('');
      setNewRewardCost('25');
      fetchRewards(profile.family_code);
    }
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
        <ActivityIndicator size="large" color="#007AFF" />
      </SafeAreaView>
    );
  }

  if (!session || !profile) {
    return <AuthScreen />;
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.header}>Hi, {profile.full_name}!</Text>
          <Text style={styles.familyTag}>
            Role: {profile.role.toUpperCase()} • Code: {profile.family_code}
          </Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== KID POINTS & STORE BANNER ==================== */}
      {profile.role === 'kid' && (
        <View style={styles.pointsBanner}>
          <View>
            <Text style={styles.pointsBannerLabel}>APPROVED POINTS BALANCE</Text>
            <Text style={styles.pointsBannerValue}>{availablePoints} pts</Text>
          </View>
          <View style={styles.kidTabRow}>
            <TouchableOpacity
              style={[styles.kidNavBtn, kidSection === 'chores' && styles.kidNavBtnActive]}
              onPress={() => setKidSection('chores')}
            >
              <Text style={[styles.kidNavText, kidSection === 'chores' && styles.kidNavTextActive]}>
                Chores
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.kidNavBtn, kidSection === 'store' && styles.kidNavBtnActive]}
              onPress={() => setKidSection('store')}
            >
              <Text style={[styles.kidNavText, kidSection === 'store' && styles.kidNavTextActive]}>
                Prize Store
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ==================== PARENT DASHBOARD ==================== */}
      {profile.role === 'parent' && (
        <View style={styles.assignBox}>
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tabBtn, parentPanel === 'assign' && styles.tabBtnActive]}
              onPress={() => setParentPanel('assign')}
            >
              <Text style={[styles.tabText, parentPanel === 'assign' && styles.tabTextActive]}>
                Assign Chore
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, parentPanel === 'new_template' && styles.tabBtnActive]}
              onPress={() => setParentPanel('new_template')}
            >
              <Text style={[styles.tabText, parentPanel === 'new_template' && styles.tabTextActive]}>
                + Add Chore
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, parentPanel === 'prizes' && styles.tabBtnActive]}
              onPress={() => setParentPanel('prizes')}
            >
              <Text style={[styles.tabText, parentPanel === 'prizes' && styles.tabTextActive]}>
                Prizes {pendingClaimsCount > 0 ? `(${pendingClaimsCount})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {parentPanel === 'assign' && (
            <>
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
                <TouchableOpacity
                  style={styles.saveDefaultBtn}
                  onPress={handleUpdateDefaultPoints}
                  disabled={!selectedTemplateId}
                >
                  <Text style={styles.saveDefaultText}>Set as New Default</Text>
                </TouchableOpacity>
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

              <TouchableOpacity style={styles.addBtn} onPress={handleAssignChore}>
                <Text style={styles.addBtnText}>Assign Chore</Text>
              </TouchableOpacity>
            </>
          )}

          {parentPanel === 'new_template' && (
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
            </>
          )}

          {parentPanel === 'prizes' && (
            <ScrollView style={{ maxHeight: 240 }}>
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

              {redemptions.length > 0 && (
                <>
                  <Text style={styles.label}>Claimed Prizes:</Text>
                  {redemptions.map((claim) => (
                    <View key={claim.id} style={styles.claimRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.claimTitle}>
                          {claim.kid_name} claimed "{claim.reward_title}"
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
            </ScrollView>
          )}
        </View>
      )}

      {/* ==================== KID PRIZE STORE VIEW ==================== */}
      {profile.role === 'kid' && kidSection === 'store' ? (
        <FlatList
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
        <>
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

          <FlatList
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
                    </View>
                    <View style={styles.badge}>
                      <Text style={styles.points}>{item.points} pts</Text>
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
                          ✓ Approve (+{item.points} pts)
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
                      <Text style={styles.completeBtnText}>
                        ⏳ Waiting for Parent Approval (Tap to Undo)
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* ==================== PAGE 3: APPROVED BADGE ==================== */}
                  {chorePage === 'approved' && (
                    <View style={styles.approvedFooter}>
                      <Text style={styles.approvedFooterText}>
                        ✅ Approved • {item.points} pts awarded
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#F5F7FA', paddingHorizontal: 20, paddingTop: 50 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1A1A1A' },
  familyTag: { fontSize: 12, color: '#666', marginTop: 2 },
  signOutBtn: { backgroundColor: '#FFEAEA', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  signOutText: { color: '#D93025', fontWeight: '600', fontSize: 13 },

  // Kid Points Banner
  pointsBanner: {
    backgroundColor: '#137333',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pointsBannerLabel: { color: '#CEEAD6', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  pointsBannerValue: { color: '#FFF', fontSize: 28, fontWeight: 'bold', marginTop: 2 },
  kidTabRow: { flexDirection: 'row', gap: 6 },
  kidNavBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)' },
  kidNavBtnActive: { backgroundColor: '#FFF' },
  kidNavText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  kidNavTextActive: { color: '#137333' },

  // Parent Dashboard
  assignBox: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, marginBottom: 12, elevation: 2 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F4F8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#007AFF' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#4A5568' },
  tabTextActive: { color: '#FFF' },
  label: { fontSize: 12, fontWeight: '700', color: '#4A5568', marginBottom: 6, marginTop: 4 },
  templateWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  templateChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  templateChipActive: { backgroundColor: '#EBF5FF', borderColor: '#007AFF' },
  templateChipText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  templateChipTextActive: { color: '#007AFF' },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  saveDefaultBtn: {
    backgroundColor: '#F0F4F8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  saveDefaultText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#D0D7DE',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  kidPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  kidChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#007AFF' },
  kidChipActive: { backgroundColor: '#007AFF' },
  kidChipText: { color: '#007AFF', fontSize: 12, fontWeight: '600' },
  kidChipTextActive: { color: '#FFF' },
  addBtn: { backgroundColor: '#007AFF', padding: 11, borderRadius: 8, alignItems: 'center' },
  smallAddBtn: { backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  addBtnText: { color: '#FFF', fontWeight: 'bold' },

  // 3-Page Chore Navigation Bar
  pageBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    padding: 4,
    borderRadius: 10,
    marginBottom: 12,
    gap: 4,
  },
  pageTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  pageTabActive: { backgroundColor: '#007AFF' },
  pageTabApprovalActive: { backgroundColor: '#E67E22' },
  pageTabApprovedActive: { backgroundColor: '#137333' },
  pageTabText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  pageTabTextActive: { color: '#FFF' },

  // Prizes & Claims
  rewardTag: { backgroundColor: '#FEF7E0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#F9AB00' },
  rewardTagText: { fontSize: 12, fontWeight: '600', color: '#B06000' },
  claimRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  claimTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },
  claimSub: { fontSize: 11, color: '#666', marginTop: 2 },
  fulfillBtn: { backgroundColor: '#137333', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  fulfillBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  redeemBtn: { backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  redeemBtnDisabled: { backgroundColor: '#94A3B8' },
  redeemBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },

  // Chore Cards
  card: { backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, elevation: 2 },
  submittedCard: { borderWidth: 2, borderColor: '#F9AB00' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '600', color: '#222' },
  completedText: { textDecorationLine: 'line-through', color: '#888' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 3 },
  badge: { backgroundColor: '#E6F4EA', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  points: { color: '#137333', fontWeight: 'bold', fontSize: 13 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBox: {
    flex: 1,
    height: 95,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D0D7DE',
    borderStyle: 'dashed',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnail: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { fontSize: 12, fontWeight: '600', color: '#007AFF' },
  uploadingText: { fontSize: 12, color: '#007AFF', marginTop: 6, textAlign: 'center' },

  // Action Buttons
  completeBtn: { backgroundColor: '#137333', padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  pendingReviewBtn: { backgroundColor: '#E67E22', padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  completeBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },

  // Parent Approval Buttons
  approvalRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  approveBtn: { flex: 2, backgroundColor: '#137333', padding: 11, borderRadius: 8, alignItems: 'center' },
  approveBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  denyBtn: { flex: 1, backgroundColor: '#D93025', padding: 11, borderRadius: 8, alignItems: 'center' },
  denyBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },

  // Approved Footer
  approvedFooter: {
    marginTop: 10,
    backgroundColor: '#E6F4EA',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  approvedFooterText: { color: '#137333', fontWeight: '700', fontSize: 13 },

  emptyText: { textAlign: 'center', color: '#888', marginTop: 30 },
});