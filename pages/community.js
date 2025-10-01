import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ref, onValue, serverTimestamp, set, push, update, get } from 'firebase/database';
import { database } from '../lib/firebase';
import { getCommunityGroup, updateUserStatus, getUserByPhone } from '../lib/auth';
import { cleanupOldMessages } from '../lib/messageCleanup';
import CustomAlert from '../components/CustomAlert';

export default function CommunityPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [communityGroup, setCommunityGroup] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [members, setMembers] = useState([]);
  const [userPhoneNumbers, setUserPhoneNumbers] = useState({}); // Store user phone numbers
  const messagesEndRef = useRef(null);

  const [alert, setAlert] = useState({ type: '', message: '' });
  const [confirmData, setConfirmData] = useState(null);

  const MAX_MESSAGE_LENGTH = 70;
  const VIRTEX_LENGTH = 3500;
  const COOLDOWN_SECONDS = 7;

  const showAlert = (type, message) => {
    setAlert({ type, message });
  };

  const showConfirm = (message, onConfirm) => {
    setConfirmData({ message, onConfirm });
  };

  // Check if user is logged in
  useEffect(() => {
    setIsClient(true);
    
    const savedUser = localStorage.getItem('chatUser');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    } else {
      // Redirect to login page
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

  // Get community group data
  useEffect(() => {
    if (!isClient || !user) return;
    
    const fetchCommunityGroup = async () => {
      try {
        const group = await getCommunityGroup();
        if (group) {
          setCommunityGroup(group);
          
          // Extract members
          if (group.members) {
            const membersList = Object.keys(group.members).map(username => ({
              username,
              ...group.members[username]
            }));
            setMembers(membersList);
            
            // Get phone numbers for all members
            const phoneNumbers = {};
            for (const member of membersList) {
              try {
                const userRef = ref(database, `users/${member.username}`);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                  const userData = userSnapshot.val();
                  phoneNumbers[member.username] = userData.phoneNumber || '';
                }
              } catch (error) {
                console.error(`Error getting phone number for ${member.username}:`, error);
              }
            }
            setUserPhoneNumbers(phoneNumbers);
          }
        } else {
          // If group doesn't exist, create it
          const communityGroupId = "komunitas_user_vorgroup";
          const groupRef = ref(database, `groups/${communityGroupId}`);
          
          await set(groupRef, {
            id: communityGroupId,
            name: "Komunitas User Vorgroup",
            description: "Grup komunitas untuk semua pengguna Vorgroup",
            createdAt: Date.now(),
            createdBy: "system",
            members: {}
          });
          
          // Add current user to the group
          const memberRef = ref(database, `groups/${communityGroupId}/members/${user.username}`);
          await set(memberRef, {
            username: user.username,
            joinedAt: Date.now(),
            role: "member"
          });
          
          // Get current user's phone number
          const currentUserRef = ref(database, `users/${user.username}`);
          const currentUserSnapshot = await get(currentUserRef);
          let phoneNumber = '';
          if (currentUserSnapshot.exists()) {
            const userData = currentUserSnapshot.val();
            phoneNumber = userData.phoneNumber || '';
          }
          
          // Fetch the group again
          const newGroup = await getCommunityGroup();
          setCommunityGroup(newGroup);
          setMembers([{
            username: user.username,
            joinedAt: Date.now(),
            role: "member"
          }]);
          setUserPhoneNumbers({
            [user.username]: phoneNumber
          });
        }
      } catch (error) {
        console.error("Error fetching community group:", error);
        showAlert('error', `Error: ${error.message}`);
      }
    };
    
    fetchCommunityGroup();
  }, [isClient, user, database]);

  // Check connection status
  useEffect(() => {
    if (!isClient) return;

    const connectedRef = ref(database, '.info/connected');
    const unsubscribeConnected = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val();
      setConnectionStatus(connected ? 'connected' : 'disconnected');
    });

    return () => unsubscribeConnected();
  }, [isClient, database]);

  // Update cooldown timer
  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = setTimeout(() => {
        setCooldownTime(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownTime]);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Set up Firebase listeners for group messages
  useEffect(() => {
    if (!isClient || !user || !communityGroup) return;

    const groupId = communityGroup.id;
    const messagesRef = ref(database, `groups/${groupId}/messages`);
    
    const unsubscribeMessages = onValue(messagesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        
        const messageList = Object.entries(data).map(([key, value]) => ({
          id: key,
          ...value
        })).sort((a, b) => {
          const timeA = a.timestamp || 0;
          const timeB = b.timestamp || 0;
          return timeA - timeB;
        });
        
        setMessages(messageList);
      } else {
        setMessages([]);
      }
    }, (error) => {
      console.error("Error fetching messages:", error);
      showAlert('error', `Error fetching messages: ${error.message}`);
    });

    return () => unsubscribeMessages();
  }, [isClient, user, communityGroup, database]);

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (newMessage.trim() === '' || !user || !communityGroup) {
      showAlert('warning', "Cannot send empty message");
      return;
    }

    if (newMessage.length > MAX_MESSAGE_LENGTH) {
      showAlert('error', `Message is too long! Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`);
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = (now - lastMessageTime) / 1000;

    if (timeSinceLastMessage < COOLDOWN_SECONDS) {
      showAlert('warning', `Please wait ${Math.ceil(COOLDOWN_SECONDS - timeSinceLastMessage)} seconds before sending another message.`);
      return;
    }

    if (newMessage.length > VIRTEX_LENGTH) {
      showAlert('error', `Message too long! Maximum ${VIRTEXT_LENGTH} characters allowed to prevent spam.`);
      return;
    }

    try {
      const groupId = communityGroup.id;
      const messagesRef = ref(database, `groups/${groupId}/messages`);
      const newMessageRef = push(messagesRef);

      // Create message with initial status
      const messageData = {
        sender: user.username,
        text: newMessage,
        timestamp: serverTimestamp(),
        deleted: false,
        deletedBy: null
      };

      await set(newMessageRef, messageData);

      setNewMessage('');
      setLastMessageTime(now);
      setCooldownTime(COOLDOWN_SECONDS);
    } catch (error) {
      console.error("Error sending message:", error);
      showAlert('error', `Error sending message: ${error.message}`);
    }
  };

  const handleMessageChange = (e) => {
    const text = e.target.value;
    if (text.length <= MAX_MESSAGE_LENGTH) {
      setNewMessage(text);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Format phone number to show only first 3 digits and last 3 digits
  const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber || phoneNumber.length < 6) return phoneNumber;
    return `${phoneNumber.substring(0, 3)}******${phoneNumber.substring(phoneNumber.length - 3)}`;
  };

  // Start a private chat with a user
  const startPrivateChat = async (username) => {
    try {
      const phoneNumber = userPhoneNumbers[username];
      if (phoneNumber) {
        router.push(`/chat?recipientPhone=${phoneNumber}`);
      } else {
        showAlert('error', 'Phone number not found for this user');
      }
    } catch (error) {
      console.error("Error starting private chat:", error);
      showAlert('error', `Error: ${error.message}`);
    }
  };

  // Handle manual cleanup of old messages
  const handleManualCleanup = async () => {
    showConfirm('Are you sure you want to delete all messages older than 24 hours?', async () => {
      try {
        const result = await cleanupOldMessages();
        if (result.success) {
          showAlert('success', `Successfully deleted ${result.deletedCount} old messages`);
        } else {
          showAlert('error', `Failed to clean up messages: ${result.error}`);
        }
        setConfirmData(null);
      } catch (error) {
        console.error("Error during manual cleanup:", error);
        showAlert('error', `Error: ${error.message}`);
        setConfirmData(null);
      }
    });
  };

  const goBack = () => {
    router.push('/');
  };

  const ConfirmModal = () => {
    if (!confirmData) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full shadow-lg">
          <p className="mb-4 text-gray-900 dark:text-gray-100">{confirmData.message}</p>
          <div className="flex justify-end space-x-4">
            <button
              onClick={() => setConfirmData(null)}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-700 rounded hover:bg-gray-400 dark:hover:bg-gray-600 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmData.onConfirm()}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!user || !communityGroup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading community group...</p>
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

      {/* Confirmation Modal */}
      <ConfirmModal />

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row justify-between items-center space-y-2 sm:space-y-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={goBack}
                className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold truncate max-w-xs">{communityGroup.name}</h1>
            </div>
            
            <div className="flex items-center space-x-2 bg-white/20 px-3 py-1 rounded-full">
              <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
              <span className="text-xs sm:text-sm font-medium capitalize">{connectionStatus}</span>
              <span className="text-xs sm:text-sm font-medium">{members.length} members</span>
              <button
                onClick={handleManualCleanup}
                className="text-xs sm:text-sm bg-orange-500/80 hover:bg-orange-500 px-2 py-1 rounded-full text-white transition flex items-center space-x-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Cleanup</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-4 sm:py-6 max-w-4xl pb-20">
        {/* Group Info */}
        <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
          <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300">{communityGroup.description}</p>
        </div>

        {/* Chat Container */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden mb-4 sm:mb-6">
          {/* Messages Area */}
          <div className="h-64 sm:h-80 md:h-96 overflow-y-auto p-4 bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-center text-sm sm:text-base">No messages yet. Start a conversation!</p>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === user.username ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-xs md:max-w-md px-3 sm:px-4 py-2 sm:py-3 rounded-2xl shadow-sm ${
                        message.sender === user.username
                          ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-br-none'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded-bl-none'
                      } relative`}
                    >
                      {/* User info with phone number */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-1">
                        <div className="flex items-center">
                          <span className={`text-xs font-medium ${
                            message.sender === user.username
                              ? 'text-indigo-200'
                              : 'text-gray-600 dark:text-gray-300'
                          }`}>
                            {message.sender}
                          </span>
                          {userPhoneNumbers[message.sender] && (
                            <>
                              <span className={`mx-1 ${
                                message.sender === user.username
                                  ? 'text-indigo-200'
                                  : 'text-gray-600 dark:text-gray-300'
                              }`}>
                                •
                              </span>
                              <span 
                                className={`text-xs font-medium cursor-pointer hover:underline ${
                                  message.sender === user.username
                                    ? 'text-indigo-200'
                                    : 'text-indigo-600 dark:text-indigo-400'
                                }`}
                                onClick={() => startPrivateChat(message.sender)}
                                title="Start private chat"
                              >
                                {formatPhoneNumber(userPhoneNumbers[message.sender])}
                              </span>
                            </>
                          )}
                        </div>
                        
                        {/* Time stamp */}
                        <span className={`text-xs ${
                          message.sender === user.username
                            ? 'text-indigo-200'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                      
                      {/* Message content with different styling */}
                      <div className={`whitespace-pre-wrap break-words text-sm sm:text-base ${
                        message.sender === user.username
                          ? 'text-white font-medium'
                          : 'text-gray-800 dark:text-gray-100'
                      }`}>
                        {message.deleted ? message.text : message.text}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Message Input */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            <form onSubmit={handleSendMessage}>
              <div className="mb-2 flex justify-between text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                <div>
                  {newMessage.length}/{MAX_MESSAGE_LENGTH} characters
                </div>
                <div className={newMessage.length > MAX_MESSAGE_LENGTH * 0.8 ? 'text-orange-500' : ''}>
                  {Math.round((newMessage.length / MAX_MESSAGE_LENGTH) * 100)}%
                </div>
              </div>
              
              <div className="flex space-x-2">
                <div className="flex-1 relative">
                  <textarea
                    value={newMessage}
                    onChange={handleMessageChange}
                    placeholder="Type your message here..."
                    rows={2}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none transition pr-20 sm:pr-24 text-sm"
                  />
                  <div className="absolute right-2 bottom-2">
                    <button
                      type="submit"
                      disabled={cooldownTime > 0 || newMessage.trim() === ''}
                      className={`px-3 sm:px-4 py-1 sm:py-2 rounded-lg font-medium text-sm ${
                        cooldownTime > 0 || newMessage.trim() === ''
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition shadow-md'
                      } text-white flex items-center space-x-1`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Members List */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              Group Members ({members.length})
            </h2>
          </div>
          
          <div className="overflow-y-auto max-h-60">
            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                <p className="text-center text-sm sm:text-base">No members found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {members.map((member) => (
                  <div key={member.username} className="p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-800 dark:text-indigo-200 font-bold text-sm sm:text-base">
                          {member.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white text-sm sm:text-base truncate max-w-[120px] sm:max-w-xs">{member.username}</h3>
                          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 capitalize">{member.role}</p>
                          {userPhoneNumbers[member.username] && (
                            <p 
                              className="text-xs text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                              onClick={() => startPrivateChat(member.username)}
                            >
                              {formatPhoneNumber(userPhoneNumbers[member.username])}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => startPrivateChat(member.username)}
                        className="px-2 sm:px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs sm:text-sm hover:bg-indigo-700 transition"
                        title="Start private chat"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-around">
            <button
              onClick={() => router.push('/')}
              className={`flex flex-col items-center justify-center py-2 sm:py-3 px-4 sm:px-6 ${
                router.pathname === '/'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-xs mt-1">Chats</span>
            </button>
            
            <button
              onClick={() => router.push('/community')}
              className={`flex flex-col items-center justify-center py-2 sm:py-3 px-4 sm:px-6 ${
                router.pathname === '/community'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-xs mt-1">Community</span>
            </button>
            
            <button
              onClick={() => router.push('/profile')}
              className={`flex flex-col items-center justify-center py-2 sm:py-3 px-4 sm:px-6 ${
                router.pathname === '/profile'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
