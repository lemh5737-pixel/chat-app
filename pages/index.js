import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ref, push, onValue, serverTimestamp, set, remove, get, child, update } from 'firebase/database';
import { database } from '../lib/firebase';
import { getUserByPhone, getAllUsers, updateUserStatus } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [systemNotifications, setSystemNotifications] = useState([]);
  const [databaseInfo, setDatabaseInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('contacts'); // 'contacts' or 'history'
  const [chatHistory, setChatHistory] = useState([]);
  const [savedContacts, setSavedContacts] = useState([]);
  const [allContacts, setAllContacts] = useState([]); // Combined list of saved contacts and people who messaged user

  const [alert, setAlert] = useState({ type: '', message: '' });
  const [confirmData, setConfirmData] = useState(null);

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
      window.location.href = '/login';
    }
  }, []);

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

  // Get all users
  useEffect(() => {
    if (!isClient) return;
    
    const fetchUsers = async () => {
      const allUsers = await getAllUsers();
      setUsers(allUsers.filter(u => u.username !== user?.username));
    };
    
    fetchUsers();
    
    // Set up listener for users status changes
    const usersRef = ref(database, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        const usersList = Object.keys(usersData)
          .map(username => ({ username, ...usersData[username] }))
          .filter(u => u.username !== user?.username);
        setUsers(usersList);
      }
    });
    
    return () => unsubscribeUsers();
  }, [isClient, user, database]);

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

  // Get chat history
  useEffect(() => {
    if (!isClient || !user) return;
    
    const chatHistoryRef = ref(database, `users/${user.username}/chatHistory`);
    const unsubscribeChatHistory = onValue(chatHistoryRef, (snapshot) => {
      if (snapshot.exists()) {
        const historyData = snapshot.val();
        const historyList = Object.keys(historyData).map(historyId => ({
          id: historyId,
          ...historyData[historyId]
        })).sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        setChatHistory(historyList);
      } else {
        setChatHistory([]);
      }
    });
    
    return () => unsubscribeChatHistory();
  }, [isClient, user, database]);

  // Combine saved contacts with people who have messaged the user
  useEffect(() => {
    if (!isClient || !user) return;
    
    // Create a map to avoid duplicates
    const contactsMap = new Map();
    
    // Add saved contacts first
    savedContacts.forEach(contact => {
      contactsMap.set(contact.phoneNumber, {
        ...contact,
        isSaved: true
      });
    });
    
    // Add people from chat history
    chatHistory.forEach(history => {
      if (!contactsMap.has(history.phoneNumber)) {
        contactsMap.set(history.phoneNumber, {
          ...history,
          isSaved: false,
          fromHistory: true
        });
      }
    });
    
    // Convert map back to array
    const combinedContacts = Array.from(contactsMap.values());
    
    // Find full user data for each contact
    const enrichedContacts = combinedContacts.map(contact => {
      const fullUserData = users.find(u => u.phoneNumber === contact.phoneNumber);
      return {
        ...contact,
        ...fullUserData,
        // Keep the original username and phoneNumber from the contact
        username: contact.username,
        phoneNumber: contact.phoneNumber
      };
    }).filter(contact => contact); // Filter out any undefined contacts
    
    setAllContacts(enrichedContacts);
  }, [savedContacts, chatHistory, users]);

  // Test database connection
  useEffect(() => {
    if (!isClient) return;

    const testRef = ref(database, '.info/serverTimeOffset');

    get(testRef).then((snapshot) => {
      if (snapshot.exists()) {
        setDatabaseInfo({
          status: "connected",
          serverTimeOffset: snapshot.val()
        });
      } else {
        setDatabaseInfo({
          status: "error",
          message: "No data returned from database"
        });
      }
    }).catch((error) => {
      setDatabaseInfo({
        status: "error",
        message: error.message
      });
    });
  }, [isClient, database]);

  // Auto-dismiss system notifications
  useEffect(() => {
    if (systemNotifications.length > 0) {
      const timer = setTimeout(() => {
        setSystemNotifications(prev => prev.slice(1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [systemNotifications]);

  // Find recipient by phone number
  const findRecipient = async () => {
    if (!recipientPhone.trim()) {
      showAlert('warning', 'Please enter a phone number');
      return;
    }
    
    const foundUser = await getUserByPhone(recipientPhone);
    if (foundUser) {
      // Redirect to chat page
      router.push(`/chat?recipientPhone=${recipientPhone}`);
    } else {
      showAlert('error', 'User not found with this phone number');
    }
  };

  // Save contact
  const saveContact = async (contact) => {
    if (!user) return;
    
    try {
      const savedContactsRef = ref(database, `users/${user.username}/savedContacts`);
      
      // Check if already saved
      const alreadySaved = savedContacts.some(c => c.phoneNumber === contact.phoneNumber);
      
      if (!alreadySaved) {
        const newContactRef = push(savedContactsRef);
        
        await set(newContactRef, {
          username: contact.username,
          phoneNumber: contact.phoneNumber,
          savedAt: Date.now()
        });
        
        showAlert('success', `Contact saved successfully`);
      } else {
        showAlert('warning', 'Contact already saved');
      }
    } catch (error) {
      console.error("Error saving contact:", error);
      showAlert('error', `Error saving contact: ${error.message}`);
    }
  };

  // Remove saved contact
  const removeSavedContact = async (contactId) => {
    if (!user) return;
    
    showConfirm('Are you sure you want to remove this contact?', () => {
      const contactRef = ref(database, `users/${user.username}/savedContacts/${contactId}`);
      remove(contactRef)
        .then(() => {
          showAlert('success', "Contact removed successfully");
        })
        .catch(error => {
          showAlert('error', `Error removing contact: ${error.message}`);
        });
      setConfirmData(null);
    });
  };

  // Check if contact is saved
  const isContactSaved = (phoneNumber) => {
    return savedContacts.some(contact => contact.phoneNumber === phoneNumber);
  };

  // Open chat from history
  const openChatFromHistory = (contact) => {
    router.push(`/chat?recipientPhone=${contact.phoneNumber}`);
  };

  const logout = () => {
    showConfirm('Are you sure you want to logout?', () => {
      if (user) {
        updateUserStatus(user.username, 'offline');
      }
      localStorage.removeItem('chatUser');
      setUser(null);
      window.location.href = '/login';
      setConfirmData(null);
    });
  };

  const testConnection = () => {
    setConnectionStatus('connecting');

    const testRef = ref(database, '.info/serverTimeOffset');

    get(testRef).then((snapshot) => {
      if (snapshot.exists()) {
        setConnectionStatus('connected');
        setDatabaseInfo({
          status: "connected",
          serverTimeOffset: snapshot.val(),
          lastTest: new Date().toLocaleTimeString()
        });
        showAlert('success', 'Connection test successful');
      } else {
        setConnectionStatus('disconnected');
        setDatabaseInfo({
          status: "error",
          message: "No data returned from database",
          lastTest: new Date().toLocaleTimeString()
        });
        showAlert('error', 'Connection test failed: No data returned');
      }
    }).catch((error) => {
      setConnectionStatus('disconnected');
      setDatabaseInfo({
        status: "error",
        message: error.message,
        lastTest: new Date().toLocaleTimeString()
      });
      showAlert('error', `Connection test failed: ${error.message}`);
    });
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

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading...</p>
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
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">VorChat App</h1>
            </div>
            
            <div className="flex flex-wrap gap-2 justify-center">
              <div className="flex items-center space-x-2 bg-white/20 px-3 py-1 rounded-full">
                <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
                <span className="text-xs sm:text-sm font-medium capitalize">{connectionStatus}</span>
              </div>
              
              <button
                onClick={testConnection}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs sm:text-sm transition flex items-center space-x-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Test</span>
              </button>
              
              <button
                onClick={logout}
                className="bg-red-500/80 hover:bg-red-500 px-3 py-1 rounded-full text-xs sm:text-sm transition flex items-center space-x-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-4 sm:py-6 max-w-4xl pb-20">
        {/* User Info */}
        <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
          <div className="flex flex-col sm:flex-row justify-between items-center">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-gray-700 dark:text-gray-300">Your Profile</h2>
              <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-4 mt-2">
                <div className="bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-3 py-1 rounded-lg font-medium text-sm sm:text-base">
                  {user.username}
                </div>
                <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-lg font-medium text-sm sm:text-base">
                  {user.phoneNumber}
                </div>
              </div>
            </div>
            <button
              onClick={() => router.push('/profile')}
              className="mt-3 sm:mt-0 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center space-x-1 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>View Profile</span>
            </button>
          </div>
        </div>

        {/* Phone Number Input */}
        <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
          <label className="block mb-2 text-gray-700 dark:text-gray-300 font-semibold text-sm sm:text-base">Chatting Sesama User:</label>
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
            <input
              type="text"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition text-sm"
              placeholder="Masukin Nomor User lain(08xx)"
            />
            <button
              onClick={findRecipient}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm"
            >
              Chat
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="mb-16">
          {activeTab === 'contacts' ? (
            <>
              {/* Contacts List */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                    Contacts ({allContacts.length})
                  </h2>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {savedContacts.length} saved
                  </div>
                </div>
                
                <div className="overflow-y-auto max-h-96">
                  {allContacts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <p className="text-center text-sm sm:text-base">No contacts found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      {allContacts.map((contact) => (
                        <div key={contact.phoneNumber} className="p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                            <div className="flex items-center space-x-3">
                              <div className="relative">
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-800 dark:text-indigo-200 font-bold text-sm sm:text-base">
                                  {contact.username.charAt(0).toUpperCase()}
                                </div>
                                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${contact.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                                {/* Show indicator for auto-added contacts */}
                                {contact.autoAdded && (
                                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                                    <span className="text-xs text-white">A</span>
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-medium text-gray-900 dark:text-white text-sm sm:text-base truncate">{contact.username}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{contact.phoneNumber}</p>
                                {contact.lastMessage && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px] sm:max-w-xs">
                                    {contact.lastMessage}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              {isContactSaved(contact.phoneNumber) ? (
                                <button
                                  onClick={() => removeSavedContact(
                                    savedContacts.find(c => c.phoneNumber === contact.phoneNumber)?.id
                                  )}
                                  className="text-sm bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 transition"
                                  title="Remove contact"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              ) : (
                                <button
                                  onClick={() => saveContact(contact)}
                                  className="text-sm bg-blue-500 text-white px-3 py-1 rounded-lg hover:bg-blue-600 transition"
                                  title="Save contact"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                  </svg>
                                </button>
                              )}
                              <button
                                onClick={() => router.push(`/chat?recipientPhone=${contact.phoneNumber}`)}
                                className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition"
                              >
                                Chat
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Chat History */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
                  <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                    Chat History ({chatHistory.length})
                  </h2>
                </div>
                
                <div className="overflow-y-auto max-h-96">
                  {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-center text-sm sm:text-base">No chat history found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      {chatHistory.map((history) => (
                        <div 
                          key={history.id} 
                          className="p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition cursor-pointer"
                          onClick={() => openChatFromHistory(history)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-800 dark:text-indigo-200 font-bold text-sm sm:text-base">
                                {history.username.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-medium text-gray-900 dark:text-white text-sm sm:text-base truncate">{history.username}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{history.phoneNumber}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px] sm:max-w-xs">
                                  {history.lastMessage}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                {new Date(history.lastMessageTime).toLocaleDateString()}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(history.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Info Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Database Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <h3 className="font-bold text-lg mb-3 text-gray-700 dark:text-gray-300 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              Database Status
            </h3>
            {databaseInfo ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className={databaseInfo.status === 'connected' ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                    {databaseInfo.status}
                  </span>
                </div>
                {databaseInfo.serverTimeOffset !== undefined && (
                  <div className="flex justify-between">
                    <span>Time Offset:</span>
                    <span>{databaseInfo.serverTimeOffset} ms</span>
                  </div>
                )}
                {databaseInfo.message && (
                  <div className="flex justify-between">
                    <span>Error:</span>
                    <span className="text-red-500 text-xs">{databaseInfo.message}</span>
                  </div>
                )}
                {databaseInfo.lastTest && (
                  <div className="flex justify-between">
                    <span>Last Test:</span>
                    <span>{databaseInfo.lastTest}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">Loading database info...</p>
            )}
          </div>

          {/* Connection Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <h3 className="font-bold text-lg mb-3 text-gray-700 dark:text-gray-300 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Connection Info
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Connection:</span>
                <span className="capitalize">{connectionStatus}</span>
              </div>
              <div className="flex justify-between">
                <span>Username:</span>
                <span className="truncate max-w-[100px] sm:max-w-[120px]">{user.username}</span>
              </div>
              <div className="flex justify-between">
                <span>Phone:</span>
                <span className="truncate max-w-[100px] sm:max-w-[120px]">{user.phoneNumber}</span>
              </div>
              {error && (
                <div className="flex justify-between">
                  <span>Error:</span>
                  <span className="text-red-500 truncate max-w-[120px] sm:max-w-[150px]">{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-around">
            <button
              onClick={() => setActiveTab('contacts')}
              className={`flex flex-col items-center justify-center py-2 sm:py-3 px-4 sm:px-6 ${
                activeTab === 'contacts'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-xs mt-1">Contacts</span>
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center justify-center py-2 sm:py-3 px-4 sm:px-6 ${
                activeTab === 'history'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs mt-1">History</span>
            </button>
            
            {/* Tombol navigasi ke halaman komunitas */}
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

      {/* Footer */}
      <footer className="mt-8 py-4 text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
        <p> VorChat App • Credit by Vortex Vipers </p>
      </footer>
    </div>
  );
}
