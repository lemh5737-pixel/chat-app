import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function Custom404() {
  const router = useRouter();

  useEffect(() => {
    // Log error untuk debugging
    console.error(`404 Error: Page not found - ${router.asPath}`);
  }, [router.asPath]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
          <div className="text-9xl font-bold mb-4">404</div>
          <h1 className="text-3xl font-bold mb-2">Halaman Tidak Ditemukan</h1>
          <p className="text-indigo-200">Ups! Sepertinya Anda tersesat.</p>
        </div>
        
        <div className="p-8">
          <div className="flex justify-center mb-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          
          <p className="text-gray-600 dark:text-gray-300 text-center mb-8">
            Halaman yang Anda cari tidak ada atau telah dipindahkan. 
            Mari kita kembali ke halaman utama dan coba lagi.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/">
              <a className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md text-center">
                Kembali ke Beranda
              </a>
            </Link>
            
            <button 
              onClick={() => router.back()}
              className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition text-center"
            >
              Kembali ke Halaman Sebelumnya
            </button>
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center text-gray-500 dark:text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} VorChat App • Credit by Vortex Vipers</p>
      </div>
    </div>
  );
    }
