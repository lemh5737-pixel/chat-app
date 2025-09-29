import { useState } from 'react';
import { useRouter } from 'next/router';
import { registerUser, loginUser } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ type: '', message: '' });
  const [debugInfo, setDebugInfo] = useState('');
  const router = useRouter();

  const showAlert = (type, message) => {
    console.log("Showing alert:", type, message);
    setAlert({ type, message });
  };

  const addDebugInfo = (info) => {
    setDebugInfo(prev => prev + '\n' + info);
    console.log(info);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setDebugInfo('');
    
    try {
      addDebugInfo(`Starting ${isLogin ? 'login' : 'registration'} process...`);
      addDebugInfo(`Username: ${username}`);
      
      let result;
      if (isLogin) {
        addDebugInfo("Calling loginUser function...");
        result = await loginUser(username, password);
      } else {
        addDebugInfo("Calling registerUser function...");
        result = await registerUser(username, password);
      }
      
      addDebugInfo(`Result received: ${JSON.stringify(result)}`);
      
      if (result.success) {
        showAlert('success', result.message);
        addDebugInfo("Saving user data to localStorage...");
        
        // Save user data to localStorage
        localStorage.setItem('chatUser', JSON.stringify(result.user));
        
        addDebugInfo("Redirecting to home page...");
        // Redirect to chat page
        setTimeout(() => {
          router.push('/');
        }, 1500);
      } else {
        showAlert('error', result.message);
        addDebugInfo(`Error: ${result.message}`);
      }
    } catch (error) {
      console.error("Submit error:", error);
      addDebugInfo(`Catch error: ${error.message}`);
      showAlert('error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <CustomAlert
        type={alert.type}
        message={alert.message}
        onClose={() => setAlert({ type: '', message: '' })}
      />
      
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white text-center">
            <h1 className="text-3xl font-bold mb-2">Chat App</h1>
            <p className="text-indigo-200">Connect with random phone numbers</p>
          </div>
          
          <div className="p-8">
            <div className="flex mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                className={`flex-1 py-2 px-4 rounded-md text-center font-medium transition-colors ${
                  isLogin 
                    ? 'bg-white dark:bg-gray-600 shadow' 
                    : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100'
                }`}
                onClick={() => setIsLogin(true)}
              >
                Login
              </button>
              <button
                className={`flex-1 py-2 px-4 rounded-md text-center font-medium transition-colors ${
                  !isLogin 
                    ? 'bg-white dark:bg-gray-600 shadow' 
                    : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100'
                }`}
                onClick={() => setIsLogin(false)}
              >
                Register
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="username" className="block text-gray-700 dark:text-gray-300 mb-2">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Enter your username"
                  required
                />
              </div>
              
              <div className="mb-6">
                <label htmlFor="password" className="block text-gray-700 dark:text-gray-300 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Enter your password"
                  required
                />
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-70"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : isLogin ? (
                  'Login'
                ) : (
                  'Register'
                )}
              </button>
            </form>
            
            <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
              <p>
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                >
                  {isLogin ? 'Register' : 'Login'}
                </button>
              </p>
            </div>
            
            {/* Debug Info Panel */}
            {debugInfo && (
              <div className="mt-6 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs font-mono text-gray-700 dark:text-gray-300 max-h-40 overflow-y-auto">
                <div className="font-bold mb-1">Debug Info:</div>
                <pre>{debugInfo}</pre>
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>By using this app, you agree to our Terms and Privacy Policy</p>
        </div>
      </div>
    </div>
  );
                   }
