import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  Alert,
} from 'react-native';

import { db } from '../firebaseConfig';
import { SUPABASE_ANON_KEY, SUPABASE_REPORT_BUCKET, SUPABASE_URL } from '../supabaseConfig';

const PRIMARY_GREEN = '#00a63e';

const AlertPage = () => {
  const [issueType, setIssueType] = useState('Overflowing Bin');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [imageUri, setImageUri] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);

  const issueOptions = [
    'Overflowing Bin',
    'Damaged Bin',
    'Broken Lid',
    'Battery Issue',
    'Neutralizer Needs Refill',
    'Sensor Malfunction',
    'Collection Delay',
    'Illegal Dumping',
    'Other',
  ];

  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  const toggleDropdown = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsDropdownOpen(!isDropdownOpen);
  };

  const selectIssue = (option) => {
    setIssueType(option);
    setIsDropdownOpen(false);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const pickImage = async (source = 'library') => {
    try {
      const picker = require('react-native-image-picker');
      const options = { mediaType: 'photo', quality: 0.7, saveToPhotos: true };
      const cb = (response) => {
        if (!response) return;
        if (response.didCancel) return;
        if (response.errorCode) {
          console.warn('Image picker error', response.errorMessage || response.errorCode);
          return;
        }
        const asset = response.assets && response.assets[0];
        if (asset && asset.uri) setImageUri(asset.uri);
      };

      if (source === 'camera' && picker.launchCamera) {
        picker.launchCamera(options, cb);
      } else if (picker.launchImageLibrary) {
        picker.launchImageLibrary(options, cb);
      }
    } catch (e) {
      Alert.alert('Image Picker Missing', 'Please install react-native-image-picker and rebuild the app: npm install react-native-image-picker');
    }
  };

  const removeImage = () => setImageUri(null);

  const uploadReportImage = async (uri, reportKey) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in supabaseConfig.js first.');
    }

    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the selected image.');
    const blob = await response.blob();
    const imagePath = `reports/${Date.now()}_${reportKey || 'image'}.jpg`;
    const encodedPath = imagePath.split('/').map(encodeURIComponent).join('/');
    const uploadResponse = await fetch(
      `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_REPORT_BUCKET)}/${encodedPath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': blob.type || 'image/jpeg',
          'x-upsert': 'false',
        },
        body: blob,
      },
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json().catch(() => null);
      throw new Error(error?.message || error?.error || `Supabase upload failed (${uploadResponse.status}).`);
    }

    return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(SUPABASE_REPORT_BUCKET)}/${encodedPath}`;
  };

  const handleSubmit = () => {
    const cleanedLocation = location.trim();
    const cleanedDescription = description.trim();

    if (!cleanedLocation || !cleanedDescription) {
      Alert.alert('Missing information', 'Please enter both the location and description before submitting the report.');
      return;
    }

    // require authenticated user before allowing report submission
    const firebaseCfg = require('../firebaseConfig');
    if (!firebaseCfg.auth || !firebaseCfg.auth.currentUser) {
      Alert.alert('Not signed in', 'You must sign in with a staff account before submitting reports.');
      return;
    }

    (async () => {
      let submittedOk = false;

      try {
        const { ref, push, set } = require('firebase/database');
        const reportsRef = ref(db, 'reports');
        const newRef = push(reportsRef);

        let imageUrl = null;
        if (imageUri) {
          try {
            setImageUploading(true);
            imageUrl = await uploadReportImage(imageUri, newRef.key);
          } catch (e) {
            Alert.alert('Image upload failed', e?.message || 'Could not upload the report image.');
            return;
          } finally {
            setImageUploading(false);
          }
        }

        const payload = {
          issueType,
          location: cleanedLocation,
          description: cleanedDescription,
          reporter: (require('../firebaseConfig').auth?.currentUser?.email) || null,
          imageUrl: imageUrl,
          createdAt: new Date().toISOString(),
        };

        await set(newRef, payload);
        submittedOk = true;

        try {
          console.log('Report saved to DB', newRef.key);
          const debugRef = ref(db, 'debug/lastReport');
          await set(debugRef, { key: newRef.key, path: `reports/${newRef.key}`, createdAt: payload.createdAt, reporter: payload.reporter });
        } catch (e) {
          console.warn('Debug write failed', e?.message || e);
        }
      } catch (e) {
        console.warn('Failed to submit report to Firebase', e?.message || e);
        Alert.alert('Submit failed', 'Failed to submit report: ' + (e?.message || e));
      } finally {
        if (submittedOk) {
          setIsModalVisible(true);
          setLocation('');
          setDescription('');
          setImageUri(null);
        }
      }
    })();
  };

  return (
    <View style={styles.container}>
      {/* DIM BACKDROP */}
      {isDropdownOpen && (
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setIsDropdownOpen(false)} />
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} scrollEnabled={!isDropdownOpen}>
        <View style={[styles.inputGroup, { zIndex: isDropdownOpen ? 1000 : 1 }]}>
          <Text style={styles.label}>Issue Type</Text>
          <TouchableOpacity style={[styles.dropdown, isDropdownOpen && styles.dropdownActive]} onPress={toggleDropdown} activeOpacity={0.8}>
            <Text style={styles.dropdownText}>{issueType}</Text>
            <Text style={styles.chevron}>{isDropdownOpen ? '▴' : '▾'}</Text>
          </TouchableOpacity>

          {isDropdownOpen && (
            <View style={styles.optionsContainer}>
              {issueOptions.map((option, index) => (
                <TouchableOpacity key={index} style={[styles.optionItem, index === issueOptions.length - 1 && { borderBottomWidth: 0 }]} onPress={() => selectIssue(option)}>
                  <Text style={[styles.optionText, issueType === option && styles.selectedOptionText]}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View pointerEvents={isDropdownOpen ? 'none' : 'auto'}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Location</Text>
            <TextInput style={styles.input} placeholder="Public Market, Aggao" placeholderTextColor="#a0a0a0" value={location} onChangeText={setLocation} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput style={[styles.input, styles.textArea]} placeholder="Need ug extra bin" placeholderTextColor="#a0a0a0" multiline numberOfLines={4} value={description} onChangeText={setDescription} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Upload Photo <Text style={styles.optional}>(Optional)</Text></Text>
            <View style={styles.photoRow}>
              {imageUri ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image source={{ uri: imageUri }} style={styles.previewImage} />
                  <TouchableOpacity style={[styles.addPhotoBtn, { marginLeft: 12 }]} onPress={removeImage}><Text style={styles.addPhotoText}>Remove</Text></TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity style={styles.addPhotoBtn} onPress={() => pickImage('library')}>
                    <Text style={styles.plusIcon}>+</Text>
                    <Text style={styles.addPhotoText}>{imageUploading ? 'Uploading...' : 'Add Photo'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.addPhotoBtn, { width: 60, height: 60 }]} onPress={() => pickImage('camera')}>
                    <Text style={{ fontSize: 20 }}>📷</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Text style={styles.submitBtnText}>Submit Report</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal animationType="fade" transparent visible={isModalVisible} onRequestClose={() => setIsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.row}>
                <Image source={require('../assets/reportbin.png')} style={styles.modalImage} />
                <View style={styles.textColumn}>
                  <Text style={styles.thankYouText}>Thank you for the concern.</Text>
                  <Text style={styles.successText}>Report Submitted Successfully!</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.okButton} onPress={() => setIsModalVisible(false)}>
                <Text style={styles.okButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
        </View>
      );
    };

    const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f8f6',
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1c1c1c',
    marginBottom: 8,
  },
  optional: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.15)',
    zIndex: 10,
  },
  dropdown: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe4df',
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  dropdownActive: {
    borderColor: PRIMARY_GREEN,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownText: {
    fontSize: 16,
    color: '#1c1c1c',
  },
  chevron: {
    fontSize: 18,
    color: '#717171',
    fontWeight: 'bold',
  },
  optionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: PRIMARY_GREEN,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  optionItem: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  optionText: {
    fontSize: 16,
    color: '#4a4a4a',
  },
  selectedOptionText: {
    color: PRIMARY_GREEN,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d1',
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1c1c1c',
    backgroundColor: '#ffffff',
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  photoRow: {
    flexDirection: 'row',
    marginTop: 5,
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: '#f5f5f5',
  },
  photoPreviewWrapper: {
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 15,
    backgroundColor: '#f5f5f5',
  },
  placeholderImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoBtn: {
    width: 120,
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  plusIcon: {
    fontSize: 30,
    color: '#1c1c1c',
    fontWeight: '300',
  },
  addPhotoText: {
    fontSize: 14,
    color: '#717171',
    fontWeight: '500',
    marginTop: 5,
  },
  submitBtn: {
    backgroundColor: PRIMARY_GREEN,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  // MODAL STYLES
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: '#f0f9f0',
    borderRadius: 25,
    padding: 25,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalContent: {
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalImage: {
    width: 110,
    height: 110,
    resizeMode: 'contain',
    marginRight: 15,
  },
  textColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  thankYouText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1c1c1c',
    marginBottom: 5,
  },
  successText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1c1c1c',
  },
  okButton: {
    backgroundColor: '#00a63e',
    borderRadius: 15,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 5,
  },
  okButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
});

export default AlertPage;
