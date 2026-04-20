import { NextResponse } from "next/server";
import { db } from "../../lib/firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import axios from "axios";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { GoogleGenerativeAI } from "@google/generative-ai";
interface FutbolVerisi {
  puanDurumu: any[];
  fikstur: any[];
}

// --- 1. ZEKİ VE KAYDIRAN FUTBOL KAZIYICI (GÜNCELLENMİŞ VERSİYON) ---
async function futbolKaziyici(): Promise<FutbolVerisi> {
  let browser = null;
  let puanlar: any[] = []; 
  let fikstur: any[] = [];

  try {
    const isLocal = process.env.NODE_ENV === 'development';
    const executablePath = isLocal 
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" 
      : await chromium.executablePath();

    browser = await puppeteer.launch({ 
      args: [...chromium.args, '--disable-web-security', '--disable-notifications'],
      executablePath: executablePath,
      headless: true 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 1000 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // --- ADIM 1: PUAN DURUMU (DOKUNULMADI, ÇALIŞAN SİSTEM) ---
    const puanUrl = 'https://www.ntvspor.net/futbol/lig/super-lig/puan-durumu';
    await page.goto(puanUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.evaluate(() => {
      const blockers = ['div[class*="modal"]', 'div[class*="overlay"]', 'div[class*="popup"]', 'iframe'];
      blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
      document.body.style.overflow = 'auto';
    });

    console.log("🖱️ Puan durumu için sayfa kaydırılıyor...");
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 200;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 2000) {
            clearInterval(timer);
            resolve(true);
          }
        }, 150);
      });
    });
    await new Promise(r => setTimeout(r, 2000));

    puanlar = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const c = row.querySelectorAll('td');
        if (c.length < 10) return null; 
        return {
          team: { name: c[2]?.textContent?.trim() || "Bilinmeyen Takım" },
          played: c[3]?.textContent?.trim() || "0",
          won: c[4]?.textContent?.trim() || "0",
          draw: c[5]?.textContent?.trim() || "0",
          lost: c[6]?.textContent?.trim() || "0",
          points: c[10]?.textContent?.trim() || "0" 
        };
      }).filter(i => i !== null && i.team.name !== "" && i.team.name !== "Bilinmeyen Takım");
    });

    // --- ADIM 2: FİKSTÜR (AKILLI İSİM KONTROLÜ EKLENDİ) ---
    const fiksturUrl = 'https://www.ntvspor.net/futbol/lig/super-lig/fikstur';
    await page.goto(fiksturUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.evaluate(() => {
      const blockers = ['div[class*="modal"]', 'div[class*="overlay"]', 'div[class*="popup"]', 'iframe'];
      blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });

    console.log("🖱️ Fikstür için sayfa kaydırılıyor...");
    await page.evaluate(() => { window.scrollBy(0, 600); });
    await new Promise(r => setTimeout(r, 2500)); 

    fikstur = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const durumYazilari = ["BŞL", "MS", "İY", "UZ", "PEN", "SAAT", "DURUM", "VS", "-", "BAŞLADI", "FİKSTÜR", "MAÇ"];
      let sonBulunanTarih = ""; 

      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || "");
        
        // 1. ADIM: Tarih başlığını yakala
        if (cells.length === 1 && cells[0].length > 5) {
          sonBulunanTarih = cells[0];
          return null;
        }

        // 2. ADIM: Skor hücresini (1-2 gibi) özel olarak yakalayalım
        // Senin filtren takımları bulurken skoru eliyor, o yüzden skoru ayrıca çekiyoruz
        const skorHucresi = cells.find(text => /^\d+-\d+$/.test(text)) || "VS";

        // 3. ADIM: Senin çalışan takım filtresi (Dokunmadık)
        const temizHücreler = cells.filter(text => 
          text.length > 2 && 
          !durumYazilari.includes(text.toUpperCase()) &&
          !text.includes(":") &&
          !/^\d+-\d+$/.test(text)
        );

        // Eğer takımları bulduysak paketi yapalım
        if (temizHücreler.length >= 2) {
          return {
            date: sonBulunanTarih,
            time: cells[0] || "Belli Değil",
            home: temizHücreler[0],
            away: temizHücreler[1],
            score: skorHucresi // ARTIK SKOR DA VAR KANKA!
          };
        }
        return null;
      }).filter(i => i !== null).slice(0, 10);
    });

    console.log(`✅ İşlem Tamam! Puanlar: ${puanlar.length}, Fikstür: ${fikstur.length}`);
    return { puanDurumu: puanlar, fikstur: fikstur };

  } catch (e: any) {
    console.log("❌ Bot Patladı kanka:", e.message);
    return { puanDurumu: puanlar || [], fikstur: [] }; 
  } finally {
    if (browser) {
      await (browser as any).close();
      console.log("🧹 Tarayıcı kapatıldı, dükkan süpürüldü.");
    }
  }
}
// FONKSİYON BURADA BİTTİ, ŞİMDİ ALTINA GET FONKSİYONUNU KOYABİLİRSİN
// --- 2. KOCAELİ ETKİNLİK KAZIYICI (YEDEK SİSTEM) ---
async function etkinlikKaziyici() {
  let browser = null;
  try {
    const isLocal = process.env.NODE_ENV === 'development';
    const executablePath = isLocal 
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" 
      : await (chromium as any).executablePath();

    browser = await puppeteer.launch({ 
      args: isLocal ? [] : (chromium as any).args, 
      executablePath: executablePath,
      headless: true 
    } as any);

    const page = await browser.newPage();
    await page.goto('https://mansetmarmara.com/etkinlikler/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const etkinlikler = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article, .post, .card, [class*="etkinlik"]'));
      return cards.slice(0, 6).map(el => {
        const h = el as HTMLElement;
        return { 
          baslik: h.querySelector('h1, h2, h3, .title')?.textContent?.trim() || "Kocaeli Etkinlik", 
          mekan: "Kocaeli", 
          saat: "20:00",
          gun: new Date().getDate().toString(), 
          ay: "NİSAN" 
        };
      });
    });

    if (etkinlikler.length > 0) console.log(`🎭 Kazıyıcıdan ${etkinlikler.length} etkinlik mühürlendi!`);
    return etkinlikler.length > 0 ? etkinlikler : null;

  } catch (err: any) { 
    console.log("⚠️ Kazıyıcı Patladı:", err.message);
    return null; 
  } finally { 
    if (browser) await (browser as any).close(); 
  }
}

// --- 3. HABERPİK: ETKİNLİK.IO API V2 (MAILDEKİ GÜNCEL BİLGİLERLE) ---
async function haberPikEtkinlikCek() {
  try {
    const token = "7064bc9e06d013150e9f3f8512983a9e"; 
    const kocaeliId = 52; 

    const res = await axios.get("https://etkinlik.io/api/v2/events", {
      headers: { "X-Etkinlik-Token": token },
      params: { "city_ids": kocaeliId, "limit": 10 }
    });

    const hamVeri = res.data?.items || res.data || [];
    
    return hamVeri.map((e: any) => ({
        baslik: e.name,
        mekan: e.venue?.name || "Kocaeli",
        saat: e.start ? e.start.substring(11, 16) : "20:00",
        gun: e.start ? e.start.substring(8, 10) : new Date().getDate().toString(),
        ay: "NİSAN",
        // KANKA: Para kazandıracak iki kritik mühür aşağıda!
        url: e.url, 
        afis: e.poster_url 
    }));
  } catch (e: any) {
    console.log("🎭 Etkinlik API Hatası:", e.message);
    return null;
  }
}

// --- 4. GAZETE MANŞETLERİ ÇEKİCİ ---
async function mansetCekici() {
  let browser = null;
  try {
    const isLocal = process.env.NODE_ENV === 'development';
    const executablePath = isLocal 
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" 
      : await (chromium as any).executablePath();

    browser = await puppeteer.launch({ 
      args: isLocal ? [] : (chromium as any).args, 
      executablePath: executablePath,
      headless: true 
    } as any);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const gazeteler = [
      { ad: "Hürriyet", slug: "hurriyet" }, { ad: "Sabah", slug: "sabah" },
      { ad: "Sözcü", slug: "sozcu" }, { ad: "Dünya", slug: "dunya" },
      { ad: "Fotomaç", slug: "fotomac" }, { ad: "Milliyet", slug: "milliyet" },
      { ad: "Türkiye", slug: "turkiye" }, { ad: "Akşam", slug: "aksam" },
      { ad: "Yeni Şafak", slug: "yeni-safak" }, { ad: "Korkusuz", slug: "korkusuz" },
      { ad: "Fanatik", slug: "fanatik" },
    ];

    const finalMansetler = [];
    for (const g of gazeteler) {
      try {
        const url = `https://www.haber7.com/gazete-mansetleri/${g.slug}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const imgUrl = await page.evaluate(() => {
          const img = document.querySelector('.newspaper-detail img') || document.querySelector('.newspaper-pages img');
          return img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;
        });
        if (imgUrl) {
          finalMansetler.push({ ad: g.ad, img: imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl, tarih: new Date().toISOString() });
        }
      } catch (e) { continue; }
    }
    return finalMansetler;
  } catch (error: any) { return null; } finally { if (browser) await (browser as any).close(); }
}

// --- 5. ANA GET FONKSİYONU (DÜZELTİLMİŞ HALİ) ---
export async function GET() {
  const tmdbKey = process.env.TMDB_API_KEY;
  const hizmetVerisi: any = { son_guncelleme: new Date().toISOString(), durum: "aktif" };

  try {
    // KANKA DİKKAT: Buradaki değişkenlere tip vermezsek TS hata verir
    const [futbolSonuc, cekilenEtkinlikler, apiEtkinlikler, gunlukMansetler]: any[] = await Promise.all([
      futbolKaziyici(),
      etkinlikKaziyici(),
      haberPikEtkinlikCek(),
      mansetCekici()
    ]);

    const [hava, kurlar, filmler, namaz] = await Promise.allSettled([
      axios.get(`https://api.openweathermap.org/data/2.5/weather?q=Kocaeli&units=metric&lang=tr&appid=8f27806f155940c6a394f4a36f4f2c0b`),
      axios.get(`https://api.exchangerate-api.com/v4/latest/TRY`),
      axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${tmdbKey}&language=tr-TR&page=1`),
      axios.get(`https://api.aladhan.com/v1/timingsByCity?city=Kocaeli&country=Turkey&method=13`)
    ]);

    // Verileri paketleme (Buralar zaten sende okey kanka)
    if (hava.status === 'fulfilled') hizmetVerisi.hava = { derece: Math.round(hava.value.data.main.temp), durum: hava.value.data.weather[0].description.toUpperCase(), ikon: hava.value.data.weather[0].icon };
    if (kurlar.status === 'fulfilled') hizmetVerisi.kurlar = { dolar: (1 / kurlar.value.data.rates.USD).toFixed(2), euro: (1 / kurlar.value.data.rates.EUR).toFixed(2) };
    if (filmler.status === 'fulfilled') hizmetVerisi.filmler = filmler.value.data.results.slice(0, 10).map((f: any) => ({ baslik: f.title, resim: `https://image.tmdb.org/t/p/w500${f.poster_path}`, puan: f.vote_average }));
    if (namaz.status === 'fulfilled') { hizmetVerisi.namaz = namaz.value.data.data.timings; hizmetVerisi.hicri_tarih = namaz.value.data.data.date.hijri; }

    // --- MÜHÜRLENECEK MALLARI RAFLARA DİZME ---
    if (futbolSonuc) {
      hizmetVerisi.puanDurumu = futbolSonuc.puanDurumu;
      hizmetVerisi.lig_durumu = futbolSonuc.puanDurumu; 
      hizmetVerisi.super_lig_fikstur = futbolSonuc.fikstur;
      hizmetVerisi.fikstur = futbolSonuc.fikstur;
    }

    hizmetVerisi.etkinlikler = apiEtkinlikler || cekilenEtkinlikler;
    if (gunlukMansetler) hizmetVerisi.gazeteMansetleri = gunlukMansetler;

    // KANKA: İki kere setDoc yapmaya gerek yok, en sonda tek seferde mühürlüyoruz!
    await setDoc(doc(db, "ayarlar", "hizmetler"), hizmetVerisi, { merge: true });
    
    console.log("🚀 TÜM DÜKKAN (Futbol, Etkinlik, Gazete) MÜHÜRLENDİ!");
    return NextResponse.json({ mesaj: "HaberPik mermi gibi kanka!" });

  } catch (error: any) { 
    console.log("❌ Ana GET Patladı:", error.message);
    return NextResponse.json({ hata: error.message }, { status: 500 }); 
  }
}
