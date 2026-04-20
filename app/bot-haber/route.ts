import { NextResponse } from "next/server";
// KANKA: lib/firebase dosyasının konumuna göre burayı ayarladım
import { db } from "../../lib/firebase"; 
import { collection, addDoc, query, getDocs, limit, orderBy, where } from "firebase/firestore";
import axios from "axios"; 
import { GoogleGenerativeAI } from "@google/generative-ai";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// --- KANKA: SLUG OLUŞTURUCU ---
const slugOlustur = (metin: string) => {
  return metin.toLowerCase().trim()
    .replace(/ /g, '-').replace(/ı/g, 'i').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
};

// --- KANKA: BAŞLIK BENZERLİK KONTROLÜ ---
const benzerlikVarMi = (yeniBaslik: string, eskiBasliklar: string[]) => {
  const temizle = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9ğüşıöç ]/g, "")
    .split(" ")
    .filter(k => k.length > 2);
    
  const yeniKelimeler = temizle(yeniBaslik);
  for (const eski of eskiBasliklar) {
    const eskiKelimeler = temizle(eski);
    const ortak = yeniKelimeler.filter(k => eskiKelimeler.includes(k)).length;
    const oran = ortak / Math.max(yeniKelimeler.length, eskiKelimeler.length);
    if (oran > 0.6) return true; 
  }
  return false;
};

// --- RESİM AVCISI ---
async function akilliResimAvcisi(page: any) {
  return await page.evaluate(() => {
    const metaSelectors = ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]', 'meta[name="thumbnail"]'];
    for (const selector of metaSelectors) {
      const content = document.querySelector(selector)?.getAttribute('content');
      if (content && content.startsWith('http')) return content;
    }
    const selectorList = ['article img', 'figure img', '.haber_resmi img', '.content img', '.post-thumbnail img', '.wp-post-image'];
    for (const s of selectorList) {
      const img = document.querySelector(s) as HTMLImageElement;
      if (img) {
        const src = img.getAttribute('data-src') || img.getAttribute('src') || img.getAttribute('data-original');
        if (src && src.startsWith('http')) return src;
      }
    }
    return null;
  });
}

// --- LİNK TOPLAYICI ---
async function linkleriTopla(browser: any, siteUrl: string) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => ({ link: a.href, baslik: a.innerText.trim() }))
        .filter(item => item.link.startsWith('http') && item.baslik.length > 40)
        .slice(0, 15);
    });
    await page.close();
    return links;
  } catch { return []; }
}

// --- HABER DETAYINA SIZMA ---
async function habereSizVeCek(browser: any, url: string) {
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 2000));
    const resim = await akilliResimAvcisi(page);
    const icerik = await page.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const metin = Array.from(document.querySelectorAll('p, article p, .haber_metni p, div.content p'))
        .map(p => p.textContent?.trim())
        .filter(t => t && t.length > 60)
        .join('\n\n');
      return { h1, metin };
    });
    return { ...icerik, resim };
  } catch { return null; }
  finally { if (page) await (page as any).close(); }
}

async function resmiBase64Yap(url: string) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    return {
      inlineData: { data: Buffer.from(res.data).toString("base64"), mimeType: res.headers["content-type"] || "image/jpeg" },
    };
  } catch { return null; }
}

export async function GET() {
  console.log("🚀 HABERPİK VERCEL BOT GÖREVDE!");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Kanka 2.5 yerine 1.5 flash kullan Vercel'de daha stabil
  let sayac = 0;
  let browser = null;

  try {
    const isLocal = process.env.NODE_ENV === 'development';
    
    // VERCEL İÇİN KRİTİK AYARLAR
    browser = await puppeteer.launch({
      args: isLocal ? [] : chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: isLocal ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : await chromium.executablePath(),
      headless: isLocal ? true : chromium.headless,
    });

    const snap = await getDocs(query(collection(db, "haberler"), orderBy("tarih", "desc"), limit(40)));
    const mevcutLinkler = snap.docs.map(d => d.data().kaynak);
    const sonHaberBasliklariDizisi = snap.docs.map(d => d.data().baslik) as string[];

    const SITELER = [
      "https://kocaelinabiz.com", "https://www.ozgurkocaeli.com.tr",
      "https://www.cagdaskocaeli.com.tr", "https://www.kocaeligazetesi.com.tr"
    ];

    for (const site of SITELER) {
      const linkler = await linkleriTopla(browser, site);
      for (const haber of linkler) {
        if (mevcutLinkler.includes(haber.link)) continue;
        if (benzerlikVarMi(haber.baslik, sonHaberBasliklariDizisi)) continue;

        const ham = await habereSizVeCek(browser, haber.link);
        // RESİM YOKSA KANKA: Senin logonu yedek olarak buraya koyacağız
        const yedekResim = "https://haberpik.com/logo.png"; 
        const haberResmi = ham?.resim || yedekResim;

        const resimData = await resmiBase64Yap(haberResmi);
        if (!resimData || !ham || ham.metin.length < 300) continue;

        const prompt = `Haber editörü gibi davran. JSON formatında: {"baslik": "...", "ozet": "...", "icerik": "...", "kategoriler": ["..."], "durum": "aktif"}`;

        try {
          const result = await model.generateContent([prompt, ham.metin, resimData]);
          const data = JSON.parse(result.response.text().match(/\{[\s\S]*\}/)?.[0] || "{}");

          if (data.durum === "aktif") {
            await addDoc(collection(db, "haberler"), { 
              ...data,
              resim: `data:${resimData.inlineData.mimeType};base64,${resimData.inlineData.data}`,
              tarih: new Date(),
              kaynak: haber.link,
              yazar: "HaberPik Bot"
            });
            sayac++;
            if (sayac >= 5) break; // Vercel timeout olmasın diye tek seferde 5 haber yeter kanka
          }
        } catch (e) { console.log("⚠️ Gemini atladı."); }
      }
      if (sayac >= 5) break;
    }
    return NextResponse.json({ mesaj: "Bitti kanka!", eklenen: sayac });
  } catch (e: any) { return NextResponse.json({ hata: e.message }); }
  finally { if (browser) await (browser as any).close(); }
}