import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ref, onValue, get, set, push, remove, update } from 'firebase/database';
import { database } from '../lib/firebase';
import { updateUserStatus } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function StoriesPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [savedContacts, setSavedContacts] = useState([]);
  const [myStories, setMyStories] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [filePreview, setFilePreview] = useState(null);
  const [fileType, setFileType] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [alert, setAlert] = useState({ type: '', message: '' });
  
  const fileInputRef = useRef(null);
  const progressIntervalRef = useRef(null);

  const showAlert = (type, message) => {
    setAlert({ type, message });
  };

  // Check if user is logged in
  useEffect(() => {
    setIsClient(true);
    
    const savedUser = localStorage.getItem('chatUser');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    } else {
      router.push('/login');
    }
  }, [router]);

  // Update user status to online
  useEffect(() => {
    if (!user || !isClient) return;
    
    updateUserStatus(user.username, 'online');
    
    // Set status to offline when page is closed
    const handleBeforeUnload = () => {
      updateUserStatus(user.username, 'offline');
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      updateUserStatus(user.username, 'offline');
    };
  }, [user, isClient]);

  // Get saved contacts
  useEffect(() => {
    if (!isClient || !user) return;
    
    const savedContactsRef = ref(database, `users/${user.username}/savedContacts`);
    const unsubscribeContacts = onValue(savedContactsRef, (snapshot) => {
      if (snapshot.exists()) {
        const contactsData = snapshot.val();
        const contactsList = Object.keys(contactsData).map(contactId => ({
          id: contactId,
          ...contactsData[contactId]
        }));
        setSavedContacts(contactsList);
      } else {
        setSavedContacts([]);
      }
    });
    
    return () => unsubscribeContacts();
  }, [isClient, user, database]);

  // Get stories from saved contacts
  useEffect(() => {
    if (!isClient || !user || savedContacts.length === 0) return;
    
    const storiesRef = ref(database, 'stories');
    const unsubscribeStories = onValue(storiesRef, (snapshot) => {
      if (snapshot.exists()) {
        const storiesData = snapshot.val();
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        // Filter stories from saved contacts and not expired
        const validStories = Object.keys(storiesData)
          .filter(username => {
            // Check if this user is in saved contacts
            const isSavedContact = savedContacts.some(contact => contact.username === username);
            if (!isSavedContact) return false;
            
            // Check if stories are not expired
            const userStories = storiesData[username];
            return Object.values(userStories).some(story => {
              return (now - story.timestamp) < twentyFourHours;
            });
          })
          .map(username => {
            const userStories = storiesData[username];
            const validUserStories = Object.keys(userStories)
              .map(storyId => ({
                id: storyId,
                username,
                ...userStories[storyId]
              }))
              .filter(story => (now - story.timestamp) < twentyFourHours)
              .sort((a, b) => a.timestamp - b.timestamp);
            
            return {
              username,
              stories: validUserStories
            };
          });
        
        setStories(validStories);
      } else {
        setStories([]);
      }
    });
    
    return () => unsubscribeStories();
  }, [isClient, user, savedContacts, database]);

  // Get user's own stories
  useEffect(() => {
    if (!isClient || !user) return;
    
    const userStoriesRef = ref(database, `stories/${user.username}`);
    const unsubscribeUserStories = onValue(userStoriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const storiesData = snapshot.val();
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        const validUserStories = Object.keys(storiesData)
          .map(storyId => ({
            id: storyId,
            username: user.username,
            ...storiesData[storyId]
          }))
          .filter(story => (now - story.timestamp) < twentyFourHours)
          .sort((a, b) => b.timestamp - a.timestamp);
        
        setMyStories(validUserStories);
      } else {
        setMyStories([]);
      }
    });
    
    return () => unsubscribeUserStories();
  }, [isClient, user, database]);

  // Handle story progress
  useEffect(() => {
    if (activeStory && isPlaying) {
      progressIntervalRef.current = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            // Move to next story
            handleNextStory();
            return 0;
          }
          return prev + 1;
        });
      }, 50); // 5000ms / 100 = 50ms per 1%
    }
    
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [activeStory, isPlaying]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check file type
    if (!file.type.match('image.*') && !file.type.match('video.*')) {
      showAlert('error', 'Please select an image or video file');
      return;
    }
    
    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      showAlert('error', 'File size must be less than 10MB');
      return;
    }
    
    // Store the selected file
    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setFilePreview(e.target.result);
      setFileType(file.type.match('image.*') ? 'image' : 'video');
    };
    reader.readAsDataURL(file);
  };

  // Upload to Catbox using FormData approach
  const uploadToCatbox = async (file) => {
    return new Promise((resolve, reject) => {
      // Get file extension
      const fileName = file.name;
      const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      
      // Check if extension is supported
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.zip', '.js', '.mp4', '.webm'];
      if (!supportedExtensions.includes(ext)) {
        reject(new Error(`File type ${ext} is not supported`));
        return;
      }
      
      console.log('Uploading file with extension:', ext);
      
      // Create FormData
      const formData = new FormData();
      formData.append('reqtype', 'fileupload');
      formData.append('fileToUpload', file);
      
      // Track upload progress
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
          console.log(`Upload progress: ${percentComplete}%`);
        }
      });
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            const response = xhr.responseText;
            console.log('Upload response:', response);
            
            // Check if the response is a valid URL
            if (!response || !response.startsWith('http')) {
              reject(new Error('Invalid response from server'));
            } else {
              resolve(response.trim());
            }
          } else {
            console.error('Upload failed with status:', xhr.status);
            console.error('Response:', xhr.responseText);
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        }
      };
      
      xhr.onerror = function() {
        console.error('Network error occurred');
        reject(new Error('Network error occurred'));
      };
      
      xhr.ontimeout = function() {
        console.error('Request timed out');
        reject(new Error('Request timed out'));
      };
      
      xhr.open('POST', 'https://catbox.moe/user/api.php', true);
      xhr.timeout = 60000; // 60 seconds timeout
      xhr.send(formData);
    });
  };

  const handleUploadStory = async () => {
    if (!filePreview || !fileType || !selectedFile) {
      showAlert('error', 'Please select a file first');
      return;
    }
    
    try {
      console.log('Starting upload process...');
      setUploading(true);
      setUploadProgress(0);
      
      showAlert('info', 'Uploading story...');
      
      // Upload to catbox.moe
      const mediaUrl = await uploadToCatbox(selectedFile);
      
      console.log('File uploaded successfully, URL:', mediaUrl);
      
      // Save to Firebase
      console.log('Saving to Firebase...');
      const storiesRef = ref(database, `stories/${user.username}`);
      const newStoryRef = push(storiesRef);
      
      const storyData = {
        mediaUrl,
        mediaType: fileType,
        timestamp: Date.now(),
        viewedBy: {}
      };
      
      console.log('Story data:', storyData);
      
      await set(newStoryRef, storyData);
      
      console.log('Story saved to Firebase successfully');
      
      showAlert('success', 'Story uploaded successfully');
      setFilePreview(null);
      setFileType(null);
      setSelectedFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error uploading story:', error);
      showAlert('error', `Failed to upload story: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const openStory = (username, index = 0) => {
    const userStories = stories.find(s => s.username === username);
    if (userStories && userStories.stories.length > 0) {
      setActiveStory(userStories);
      setActiveStoryIndex(index);
      setProgress(0);
      setIsPlaying(true);
      
      // Mark story as viewed
      const storyId = userStories.stories[index].id;
      markStoryAsViewed(username, storyId);
    }
  };

  const markStoryAsViewed = async (username, storyId) => {
    try {
      const storyViewRef = ref(database, `stories/${username}/${storyId}/viewedBy/${user.username}`);
      await set(storyViewRef, {
        viewedAt: Date.now()
      });
    } catch (error) {
      console.error('Error marking story as viewed:', error);
    }
  };

  const handleNextStory = () => {
    if (!activeStory) return;
    
    if (activeStoryIndex < activeStory.stories.length - 1) {
      // Move to next story of the same user
      setActiveStoryIndex(prev => prev + 1);
      setProgress(0);
      
      // Mark next story as viewed
      const nextStoryId = activeStory.stories[activeStoryIndex + 1].id;
      markStoryAsViewed(activeStory.username, nextStoryId);
    } else {
      // Move to next user's story
      const currentUserIndex = stories.findIndex(s => s.username === activeStory.username);
      if (currentUserIndex < stories.length - 1) {
        const nextUser = stories[currentUserIndex + 1];
        setActiveStory(nextUser);
        setActiveStoryIndex(0);
        setProgress(0);
        
        // Mark first story of next user as viewed
        if (nextUser.stories.length > 0) {
          markStoryAsViewed(nextUser.username, nextUser.stories[0].id);
        }
      } else {
        // End of stories
        closeStoryViewer();
      }
    }
  };

  const handlePrevStory = () => {
    if (!activeStory) return;
    
    if (activeStoryIndex > 0) {
      // Move to previous story of the same user
      setActiveStoryIndex(prev => prev - 1);
      setProgress(0);
    } else {
      // Move to previous user's story
      const currentUserIndex = stories.findIndex(s => s.username === activeStory.username);
      if (currentUserIndex > 0) {
        const prevUser = stories[currentUserIndex - 1];
        setActiveStory(prevUser);
        setActiveStoryIndex(prevUser.stories.length - 1);
        setProgress(0);
      } else {
        // Stay at first story
        setProgress(0);
      }
    }
  };

  const closeStoryViewer = () => {
    setActiveStory(null);
    setActiveStoryIndex(0);
    setProgress(0);
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const deleteMyStory = async (storyId) => {
    try {
      const storyRef = ref(database, `stories/${user.username}/${storyId}`);
      await remove(storyRef);
      showAlert('success', 'Story deleted successfully');
    } catch (error) {
      console.error('Error deleting story:', error);
      showAlert('error', 'Failed to delete story');
    }
  };

  const goBack = () => {
    router.push('/');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading stories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 font-sans flex flex-col">
      {/* Alert Component */}
      <CustomAlert
        type={alert.type}
        message={alert.message}
        onClose={() => setAlert({ type: '', message: '' })}
      />

      {/* Story Viewer Modal */}
      {activeStory && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
          <div className="relative w-full h-full max-w-md mx-auto">
            {/* Progress Bar */}
            <div className="absolute top-4 left-0 right-0 flex space-x-1 px-4 z-10">
              {activeStory.stories.map((_, index) => (
                <div key={index} className="flex-1 h-1 bg-gray-600 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${index === activeStoryIndex ? 'bg-white' : 'bg-gray-600'}`}
                    style={{ width: index === activeStoryIndex ? `${progress}%` : '100%' }}
                  ></div>
                </div>
              ))}
            </div>
            
            {/* Story Content */}
            <div className="w-full h-full flex items-center justify-center">
              {activeStory.stories[activeStoryIndex]?.mediaType === 'image' ? (
                <img 
                  src={activeStory.stories[activeStoryIndex]?.mediaUrl} 
                  alt="Story"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <video 
                  src={activeStory.stories[activeStoryIndex]?.mediaUrl}
                  className="max-w-full max-h-full object-contain"
                  controls
                  autoPlay
                  muted
                />
              )}
            </div>
            
            {/* User Info */}
            <div className="absolute top-12 left-4 right-4 flex items-center z-10">
              <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold mr-3">
                {activeStory.username.charAt(0).toUpperCase()}
              </div>
              <div className="text-white">
                <div className="font-semibold">{activeStory.username}</div>
                <div className="text-xs opacity-80">
                  {new Date(activeStory.stories[activeStoryIndex]?.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
            
            {/* Navigation Buttons */}
            <button 
              className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
              onClick={handlePrevStory}
            ></button>
            <button 
              className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
              onClick={handleNextStory}
            ></button>
            
            {/* Close Button */}
            <button 
              className="absolute top-4 right-4 text-white z-10"
              onClick={closeStoryViewer}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Play/Pause Button */}
            <button 
              className="absolute bottom-4 right-4 text-white z-10"
              onClick={togglePlayPause}
            >
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <button
                onClick={goBack}
                className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold">Stories</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-4xl pb-20">
        {/* Upload Story Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Create Your Story</h2>
          
          {filePreview ? (
            <div className="mb-4">
              <div className="relative">
                {fileType === 'image' ? (
                  <img 
                    src={filePreview} 
                    alt="Preview" 
                    className="w-full h-64 object-cover rounded-lg"
                  />
                ) : (
                  <video 
                    src={filePreview}
                    className="w-full h-64 object-cover rounded-lg"
                    controls
                  />
                )}
                <button
                  onClick={() => {
                    setFilePreview(null);
                    setFileType(null);
                    setSelectedFile(null);
                    setUploadProgress(0);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Upload Progress */}
              {uploading && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                    <span>Uploading...</span>
                    <span>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-indigo-600 h-2.5 rounded-full" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              
              <div className="flex justify-end mt-4 space-x-2">
                <button
                  onClick={() => {
                    setFilePreview(null);
                    setFileType(null);
                    setSelectedFile(null);
                    setUploadProgress(0);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUploadStory}
                  disabled={uploading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Post Story'}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400 mb-4">Share a photo or video to your story</p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,video/*"
                className="hidden"
                id="story-upload"
              />
              <label
                htmlFor="story-upload"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition cursor-pointer inline-block"
              >
                Select Media
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Supported formats: .jpg, .jpeg, .png, .gif, .mp4, .webm (Max 10MB)
              </p>
            </div>
          )}
        </div>

        {/* My Stories Section */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Your Stories</h2>
          
          {myStories.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400">You don't have any stories yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {myStories.map((story) => (
                <div key={story.id} className="relative">
                  <div 
                    className="aspect-square rounded-lg overflow-hidden cursor-pointer"
                    onClick={() => openStory(user.username, myStories.findIndex(s => s.id === story.id))}
                  >
                    {story.mediaType === 'image' ? (
                      <img 
                        src={story.mediaUrl} 
                        alt="Your story"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video 
                        src={story.mediaUrl}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  
                  <div className="absolute top-2 right-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMyStory(story.id);
                      }}
                      className="bg-red-500 text-white rounded-full p-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  <div className="absolute bottom-2 left-2 text-white text-xs">
                    {new Date(story.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Friends' Stories Section */}
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Friends' Stories</h2>
          
          {stories.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400">No stories from your contacts</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {stories.map((userStories) => (
                <div 
                  key={userStories.username} 
                  className="cursor-pointer"
                  onClick={() => openStory(userStories.username)}
                >
                  <div className="relative">
                    <div className="aspect-square rounded-lg overflow-hidden">
                      {userStories.stories[0]?.mediaType === 'image' ? (
                        <img 
                          src={userStories.stories[0]?.mediaUrl} 
                          alt={`${userStories.username}'s story`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video 
                          src={userStories.stories[0]?.mediaUrl}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    
                    <div className="absolute top-2 left-2">
                      <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold border-2 border-white">
                        {userStories.username.charAt(0).toUpperCase()}
                      </div>
                    </div>
                    
                    <div className="absolute bottom-2 left-2 text-white text-sm font-medium">
                      {userStories.username}
                    </div>
                    
                    <div className="absolute bottom-2 right-2 bg-blue-500 text-white text-xs rounded-full px-2 py-1">
                      {userStories.stories.length}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-around">
            <button
              onClick={() => router.push('/')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-xs mt-1">Chats</span>
            </button>
            
            <button
              onClick={() => router.push('/stories')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/stories'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs mt-1">Stories</span>
            </button>
            
            <button
              onClick={() => router.push('/')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-xs mt-1">Contacts</span>
            </button>
            
            <button
              onClick={() => router.push('/profile')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/profile'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs mt-1">Profile</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}
