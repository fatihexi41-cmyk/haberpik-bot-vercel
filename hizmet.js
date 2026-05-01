require('dotenv').config({ path: '.env.local' });const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

// --- 1. FIREBASE BAĞLANTISI ---
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- 2. API ÜZERİNDEN PUAN DURUMU VE FİKSTÜR ---
async function futbolVerisiCek() {
    try {
        console.log("⚽ Futbol verisi için API kapısı çalınıyor...");
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/standings',
            params: { league: '203', season: '2025' }, // 2025 sezonu aktif değilse 2024 deneyebiliriz
            headers: {
                'x-apisports-key': process.env.RAPIDAPI_KEY 
            }
        };

        const response = await axios.request(options);
        
        // Kanka burası çok kritik, API tam olarak ne diyor görelim:
        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            console.log("❌ API Hatası:", response.data.errors);
            return null;
        }

        if (response.data && response.data.response && response.data.response.length > 0) {
            const standings = response.data.response[0].league.standings[0];
            const puanlar = standings.map(item => ({
                team: { name: item.team.name },
                played: item.all.played,
                won: item.all.win,
                draw: item.all.draw,
                lost: item.all.lose,
                points: item.points
            }));
            console.log(`✅ ${puanlar.length} takımın verisi alındı.`);
            return { puanDurumu: puanlar };
        } else {
            console.log("⚠️ API yanıt verdi ama içinde puan durumu yok. Sezon veya Lig kodu hatalı olabilir.");
            console.log("Gelen Yanıt:", JSON.stringify(response.data, null, 2)); // Yanıtın tamamını dök kanka
            return null;
        }
    } catch (e) {
        console.log("❌ Bağlantı Hatası:", e.message);
        return null;
    }
}

// --- 3. ANA MOTOR ---
async function tumHizmetleriGuncelle() {
    console.log(`🚀 [${new Date().toLocaleTimeString()}] Hizmetler Güncelleniyor (API Modu)...`);
    const hizmetVerisi = { son_guncelleme: new Date().toISOString(), durum: "aktif" };

    try {
        // Futbol (Artık kazıyıcı yok, tertemiz API var!)
        const futbol = await futbolVerisiCek();
        
        // Hava ve Namaz zaten API ile geliyordu, mermi gibi devam
        const [hava, namaz] = await Promise.all([
            axios.get(`https://api.openweathermap.org/data/2.5/weather?q=Kocaeli&units=metric&lang=tr&appid=3621d987bf248bae5c97fe8de5758005`),
            axios.get(`https://api.aladhan.com/v1/timingsByCity?city=Kocaeli&country=Turkey&method=13`)
        ]);

        if (futbol) {
            hizmetVerisi.puanDurumu = futbol.puanDurumu;
            hizmetVerisi.lig_durumu = futbol.puanDurumu;
        }
        if (hava.data) {
            hizmetVerisi.hava = { 
                derece: Math.round(hava.data.main.temp), 
                durum: hava.data.weather[0].description.toUpperCase(),
                ikon: `https://openweathermap.org/img/wn/${hava.data.weather[0].icon}@2x.png`
            };
        }
        if (namaz.data) {
            hizmetVerisi.namaz = namaz.data.data.timings;
        }

        await setDoc(doc(db, "ayarlar", "hizmetler"), hizmetVerisi, { merge: true });
        console.log("✅ Hizmetler API ile Mühürlendi!");

    } catch (error) {
        console.error("❌ Hizmet Motoru Patladı:", error.message);
    }
}

// Günde 4 kez çalışsın kanka, RapidAPI kotan bitmesin
setInterval(tumHizmetleriGuncelle, 6 * 60 * 60 * 1000);
tumHizmetleriGuncelle();