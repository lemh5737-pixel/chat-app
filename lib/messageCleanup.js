import { ref, get, query, orderByChild, remove } from 'firebase/database';
import { database } from './firebase';

// Fungsi untuk menghapus pesan yang lebih tua dari 24 jam
export const cleanupOldMessages = async () => {
  try {
    console.log("Starting message cleanup process...");
    
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    let deletedCount = 0;
    
    // Dapatkan semua chat room
    const chatsRef = ref(database, 'chats');
    const chatsSnapshot = await get(chatsRef);
    
    if (chatsSnapshot.exists()) {
      const chats = chatsSnapshot.val();
      
      // Proses setiap chat room
      for (const chatId in chats) {
        const messagesRef = ref(database, `chats/${chatId}/messages`);
        const messagesSnapshot = await get(messagesRef);
        
        if (messagesSnapshot.exists()) {
          const messages = messagesSnapshot.val();
          const messagesToDelete = [];
          
          // Identifikasi pesan yang lebih tua dari 24 jam
          for (const messageId in messages) {
            const message = messages[messageId];
            // Jika timestamp tidak ada, anggap pesan lama
            if (!message.timestamp || message.timestamp < twentyFourHoursAgo) {
              messagesToDelete.push(messageId);
            }
          }
          
          // Hapus pesan yang diidentifikasi
          if (messagesToDelete.length > 0) {
            for (const messageId of messagesToDelete) {
              await remove(ref(database, `chats/${chatId}/messages/${messageId}`));
              deletedCount++;
            }
            console.log(`Deleted ${messagesToDelete.length} messages from chat ${chatId}`);
          }
        }
      }
    }
    
    // Bersihkan juga pesan di grup komunitas
    const groupsRef = ref(database, 'groups');
    const groupsSnapshot = await get(groupsRef);
    
    if (groupsSnapshot.exists()) {
      const groups = groupsSnapshot.val();
      
      // Proses setiap grup
      for (const groupId in groups) {
        const messagesRef = ref(database, `groups/${groupId}/messages`);
        const messagesSnapshot = await get(messagesRef);
        
        if (messagesSnapshot.exists()) {
          const messages = messagesSnapshot.val();
          const messagesToDelete = [];
          
          // Identifikasi pesan yang lebih tua dari 24 jam
          for (const messageId in messages) {
            const message = messages[messageId];
            if (!message.timestamp || message.timestamp < twentyFourHoursAgo) {
              messagesToDelete.push(messageId);
            }
          }
          
          // Hapus pesan yang diidentifikasi
          if (messagesToDelete.length > 0) {
            for (const messageId of messagesToDelete) {
              await remove(ref(database, `groups/${groupId}/messages/${messageId}`));
              deletedCount++;
            }
            console.log(`Deleted ${messagesToDelete.length} messages from group ${groupId}`);
          }
        }
      }
    }
    
    console.log(`Message cleanup completed. Total deleted: ${deletedCount} messages`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error("Error during message cleanup:", error);
    return { success: false, error: error.message };
  }
};

// Fungsi untuk menjalankan pembersihan setiap 24 jam
export const scheduleMessageCleanup = () => {
  // Jalankan pertama kali setelah halaman dimuat
  setTimeout(() => {
    cleanupOldMessages();
  }, 60000); // Tunggu 1 menit setelah halaman dimuat
  
  // Atur interval untuk 24 jam
  setInterval(() => {
    cleanupOldMessages();
  }, 24 * 60 * 60 * 1000); // 24 jam dalam milidetik
  
  console.log("Message cleanup scheduled to run every 24 hours");
};
