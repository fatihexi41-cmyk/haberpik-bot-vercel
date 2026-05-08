require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

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

// --- YARDIMCI: TARAYICI BAŞLATICI ---
async function getBrowser() {
  const isWindows = process.platform === 'win32';
  return await puppeteer.launch({
    args: isWindows ? [] : [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: isWindows 
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" 
      : await chromium.executablePath(),
    headless: true
  });
}

// --- 2. NTV SPOR KAZIYICI ---
async function futbolKaziyici() {
  let browser = null;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 2000 });

    // 1. ADIM: PUAN DURUMU
    await page.goto('https://www.ntvspor.net/futbol/lig/super-lig/puan-durumu', { waitUntil: 'networkidle2' });
    
    await page.evaluate(() => {
      const selectors = ['.ad-container', 'iframe', '.overlay', '.modal', '#onetrust-consent-sdk'];
      selectors.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });
    
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(r => setTimeout(r, 2000));

    const puanlar = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const c = Array.from(row.querySelectorAll('td'));
        const teamName = c[2]?.innerText?.trim();
        if (!teamName || teamName.length < 2) return null;
        return {
          team: { name: teamName },
          played: c[3]?.innerText?.trim() || "0",
          won: c[4]?.innerText?.trim() || "0",
          draw: c[5]?.innerText?.trim() || "0",
          lost: c[6]?.innerText?.trim() || "0",
          points: c[10]?.innerText?.trim() || "0"
        };
      }).filter(i => i !== null);
    });

    // 2. ADIM: FİKSTÜR
    await page.goto('https://www.ntvspor.net/futbol/lig/super-lig/fikstur', { waitUntil: 'networkidle2' });
    
    await page.evaluate(() => {
      const blockers = ['#onetrust-banner-sdk', '.secondary-nav', 'header'];
      blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
      document.body.style.overflow = 'auto';
    });

    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 3000));

    const fikstur = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const durumYazilari = ["BŞL", "MS", "İY", "UZ", "PEN", "SAAT", "DURUM", "VS", "-", "BAŞLADI", "FİKSTÜR", "MAÇ"];
      let sonBulunanTarih = ""; 

      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || "");
        if (cells.length === 1 && cells[0].length > 5) {
          sonBulunanTarih = cells[0];
          return null;
        }
        const skorHucresi = cells.find(text => /^\d+-\d+$/.test(text)) || "VS";
        const temizHucyeler = cells.filter(text => 
          text.length > 2 && 
          !durumYazilari.includes(text.toUpperCase()) &&
          !text.includes(":") &&
          !/^\d+-\d+$/.test(text)
        );

        if (temizHucyeler.length >= 2) {
          return {
            date: sonBulunanTarih || "Gelecek Program",
            time: cells[0] || "00:00",
            home: temizHucyeler[0],
            away: temizHucyeler[1],
            score: skorHucresi
          };
        }
        return null;
      }).filter(i => i !== null).slice(0, 10);
    });

    return { puanDurumu: puanlar, fikstur: fikstur };

  } catch (e) {
    console.log("❌ Futbol Motoru Patladı:", e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// --- 3. GAZETE MANŞETLERİ ---
async function mansetCekici() {
  let browser = null;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    const gazeteler = [
      { ad: "Hürriyet", slug: "hurriyet" }, { ad: "Sabah", slug: "sabah" },
      { ad: "Sözcü", slug: "sozcu" }, { ad: "Dünya", slug: "dunya" },
      { ad: "Fotomaç", slug: "fotomac" }, { ad: "Milliyet", slug: "milliyet" },
      { ad: "Türkiye", slug: "turkiye" }, { ad: "Akşam", slug: "aksam" },
      { ad: "Yeni Şafak", slug: "yeni-safak" }, { ad: "Korkusuz", slug: "korkusuz" },
      { ad: "Fanatik", slug: "fanatik" }
    ];
    const sonuclar = [];
    for (const g of gazeteler) {
      try {
        await page.goto(`https://www.haber7.com/gazete-mansetleri/${g.slug}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const imgUrl = await page.evaluate(() => {
          const img = document.querySelector('.newspaper-detail img') || 
                      document.querySelector('.newspaper-pages img') ||
                      document.querySelector('.newspaper-all img');
          return img ? (img.src || img.getAttribute('data-src') || img.getAttribute('srcset')?.split(' ')[0]) : null;
        });
        if (imgUrl) {
          const cleanUrl = imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl;
          sonuclar.push({ ad: g.ad, img: cleanUrl, tarih: new Date().toISOString() });
        }
      } catch (e) { continue; }
    }
    return sonuclar;
  } catch (e) {
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// --- 3.5. TMDB FİLM VERİLERİ ---
async function filmleriCek() {
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) return [];
    const res = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${tmdbKey}&language=tr-TR&page=1`);
    return res.data.results.slice(0, 10).map(f => ({
      baslik: f.title,
      resim: `https://image.tmdb.org/t/p/w500${f.poster_path}`,
      puan: f.vote_average,
      ozet: f.overview
    }));
  } catch (e) {
    return [];
  }
}

// --- 4. ETKİNLİK.IO API ---
async function haberPikEtkinlikCek() {
  try {
    const token = "7064bc9e06d013150e9f3f8512983a9e";
    const res = await axios.get("https://etkinlik.io/api/v2/events", {
      headers: { "X-Etkinlik-Token": token },
      params: { "city_ids": 52, "limit": 8 }
    });
    return (res.data?.items || res.data || []).map(e => ({
      baslik: e.name,
      mekan: e.venue?.name || "Kocaeli",
      saat: e.start ? e.start.substring(11, 16) : "20:00",
      gun: e.start ? e.start.substring(8, 10) : new Date().getDate().toString(),
      ay: "MAYIS",
      url: e.url,
      afis: e.poster_url
    }));
  } catch (e) {
    return [];
  }
}

// --- 5. ANA MOTOR ---
async function tumHizmetleriGuncelle() {
  console.log(`🚀 [${new Date().toLocaleTimeString()}] Operasyon Başladı...`);
  const hizmetVerisi = { son_guncelleme: new Date().toISOString(), durum: "aktif" };

  try {
    const [futbol, mansetler, etkinlikler, filmler] = await Promise.all([
      futbolKaziyici(),
      mansetCekici(),
      haberPikEtkinlikCek(),
      filmleriCek()
    ]);

    const [havaRes, namazRes] = await Promise.allSettled([
      axios.get(`https://api.openweathermap.org/data/2.5/weather?q=Kocaeli&units=metric&lang=tr&appid=3621d987bf248bae5c97fe8de5758005`),
      axios.get(`https://api.aladhan.com/v1/timingsByCity?city=Kocaeli&country=Turkey&method=13`)
    ]);

    if (futbol) {
      hizmetVerisi.puanDurumu = futbol.puanDurumu;
      hizmetVerisi.lig_durumu = futbol.puanDurumu;
      if (futbol.fikstur) {
        hizmetVerisi.fikstur = futbol.fikstur;
        hizmetVerisi.super_lig_fikstur = futbol.fikstur;
      }
    }
    if (mansetler) hizmetVerisi.gazeteMansetleri = mansetler;
    if (etkinlikler) hizmetVerisi.etkinlikler = etkinlikler;
    if (filmler) hizmetVerisi.filmler = filmler;

    if (havaRes.status === 'fulfilled') {
      hizmetVerisi.hava = { 
        derece: Math.round(havaRes.value.data.main.temp), 
        durum: havaRes.value.data.weather[0].description.toUpperCase(),
        ikon: `https://openweathermap.org/img/wn/${havaRes.value.data.weather[0].icon}@2x.png`
      };
    }
    if (namazRes.status === 'fulfilled') {
      hizmetVerisi.namaz = namazRes.value.data.data.timings;
    }

    await setDoc(doc(db, "ayarlar", "hizmetler"), hizmetVerisi, { merge: true });
    console.log("🚀 Dükkan mermi gibi güncellendi!");

  } catch (error) {
    console.error("❌ Motor Patladı:", error.message);
  }
}

setInterval(tumHizmetleriGuncelle, 6 * 60 * 60 * 1000);
tumHizmetleriGuncelle();