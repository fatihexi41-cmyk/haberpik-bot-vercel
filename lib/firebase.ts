import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  // KANKA: Local'deki .env dosyasından bakıp burayı doldur, sunucunun insafına bırakma
  apiKey: "AIzaSyDPBCVpJETt8jpYLV4PP8XpMI_-JKTcJyE", 
  authDomain: "kocaelihaber-e779e.firebaseapp.com",
  projectId: "kocaelihaber-e779e",
  storageBucket: "kocaelihaber-e779e.appspot.com",
  messagingSenderId: "980487271491",
  appId: "1:980487271491:web:9cbd1898a59d441d2350f6"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);