import { NextResponse } from "next/server";
import { db } from "../../lib/firebase"; 
import { collection, addDoc, query, getDocs, limit, orderBy } from "firebase/firestore";
import axios from "axios"; 
import * as cheerio from "cheerio"; 
import RSSParser from "rss-parser"; 
import { GoogleGenerativeAI } from "@google/generative-ai";

const parser = new RSSParser();

// --- KATEGORİ SİHİRBAZI: KESKİN YERLEŞİM VE ÇOKLU VİTRİN MÜHRÜ ---
const kategoriEsle = (anaKategori: string, kaynak: string, baslik: string = "") => {
  const k = (anaKategori + " " + baslik).toUpperCase();
  let katlar: string[] = [];
  
  // 1. KOCAELİ KUTSAL BÖLGESİ (ANASLIDER ve GÜNDEM ÖZETİ BURASI)
  if (kaynak === 'Çağdaş Kocaeli') {
    // Kocaeli haberleri sadece GÜNDEM ve ANASLIDER'a gidebilir
    katlar.push('GÜNDEM'); 
    katlar.push('ANASLIDER'); 

    // Yerel Özel Alt Kategori Taraması
    if (k.includes('SPOR') || k.includes('KOCAELİSPOR')) katlar.push('YEREL SPOR');
    if (k.includes('ASAYİŞ')) katlar.push('ASAYİŞ');
    if (k.includes('SİYASET')) katlar.push('SİYASET');
    if (k.includes('YAŞAM') || k.includes('MAGAZİN')) katlar.push('HAYATIN İÇİNDEN');
  } 
  
  // 2. ULUSAL BÖLGE (TÜRKİYE, DÜNYA, SPOR, EKONOMİ SLIDERLARI)
  else {
    const rssKat = anaKategori.toUpperCase().trim();
    
    // RSS'den gelen kategoriye göre net yerleştirme
    if (rssKat === 'SPOR') {
      katlar.push('SPOR'); // Ulusal Spor Slider'ı ve Kategorisi
    } else if (rssKat === 'DÜNYA') {
      katlar.push('DÜNYA'); // Dünya Slider'ı ve Kategorisi
    } else if (rssKat === 'EKONOMİ') {
      katlar.push('EKONOMİ'); // Ekonomi Slider'ı ve Kategorisi
    } else if (rssKat === 'SİYASET') {
      katlar.push('SİYASET');
    } else if (rssKat === 'ASAYİŞ') {
      katlar.push('ASAYİŞ');
    } else if (rssKat === 'TÜRKİYE' || rssKat === 'TÜRKİYE HABERLERİ') {
      katlar.push('TÜRKİYE HABERLERİ'); // Türkiye Slider'ı ve Kategorisi
    } else {
      // Magazin, Teknoloji vb. diğer ulusal dallar
      katlar.push(rssKat);
    }
  }

  // 3. İSTİSNAİ ÇOKLU KATEGORİ (Arama terimlerine göre her iki gruptan da süzülebilir)
  // Bu kısım haberin menüdeki özel sayfalarda da çıkmasını sağlar
  if (k.includes('OTOMOBİL') || k.includes('ARABA')) katlar.push('OTOMOBİL');
  if (k.includes('SAĞLIK') || k.includes('HASTANE')) katlar.push('SAĞLIK');
  if (k.includes('EĞİTİM') || k.includes('OKUL')) katlar.push('EĞİTİM');
  if (k.includes('EMLAK') || k.includes('TOKİ')) katlar.push('EMLAK');

  // Boşta kalma ihtimaline karşı sigorta
  if (katlar.length === 0) {
    katlar.push(kaynak === 'Çağdaş Kocaeli' ? 'GÜNDEM' : 'TÜRKİYE HABERLERİ');
  }

  return [...new Set(katlar)]; 
};

const ULUSAL_RSS = [
  { kat: 'SPOR', kaynak: 'A Haber Spor', url: 'https://www.ahaber.com.tr/rss/spor.xml' },
  { kat: 'EKONOMİ', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/ekonomi.xml' },
  { kat: 'MAGAZİN', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/magazin.xml' },
  { kat: 'HAYATIN İÇİNDEN', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/yasam.xml' },
  { kat: 'OTOMOBİL', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/otomobil.xml' },
  { kat: 'BİLİM TEKNOLOJİ', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/teknoloji.xml' },
  { kat: 'SAĞLIK', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/saglik.xml' },
  { kat: 'KÜLTÜR SANAT', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/kultur-sanat/news' },
  { kat: 'DÜNYA', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/dunya/news' },
  { kat: 'EĞİTİM', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/egitim/news' },
  { kat: 'TÜRKİYE HABERLERİ', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/turkiye/news' }
];

const YEREL_HEDEFLER = ['GÜNDEM', 'SİYASET', 'KOCAELİSPOR', 'ASAYİŞ', 'YAŞAM'];

export async function GET() {
  console.log("🚀 HABERPİK 2.5 FLASH: DİSİPLİNLİ YERLEŞİM OPERASYONU!");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
  let sayac = 0;

  try {
    const snap = await getDocs(query(collection(db, "haberler"), orderBy("tarih", "desc"), limit(150)));
    const mevcutLinkler = snap.docs.map(d => d.data().kaynak);

    let tumAdaylar: any[] = [];

    try {
      const { data } = await axios.get('https://www.cagdaskocaeli.com.tr/arsiv', { 
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const $ = cheerio.load(data);
      $('h3').each((_, element) => {
        const siteKategori = $(element).text().trim().toUpperCase();
        if (YEREL_HEDEFLER.includes(siteKategori)) {
          $(element).next('ul').find('li a').each((i, a) => {
            if (i < 10) {
              const href = $(a).attr('href');
              const link = href?.startsWith('http') ? href : "https://www.cagdaskocaeli.com.tr" + href;
              if (href && !mevcutLinkler.includes(link) && !link.includes('/video/') && !link.includes('/foto/')) {
                tumAdaylar.push({ 
                  link, 
                  rssKategorisi: siteKategori, 
                  kaynak: 'Çağdaş Kocaeli' 
                });
              }
            }
          });
        }
      });
    } catch (e) { console.log("⚠️ Yerel tarama aksadı."); }

    for (const rss of ULUSAL_RSS) {
      try {
        const feed = await parser.parseURL(rss.url);
        feed.items.slice(0, 10).forEach(item => {
          if (item.link && !mevcutLinkler.includes(item.link)) {
            tumAdaylar.push({ 
              link: item.link, 
              rssKategorisi: rss.kat, 
              kaynak: rss.kaynak 
            });
          }
        });
      } catch (e) { console.log(`⚠️ ${rss.kaynak} RSS atlandı.`); }
    }

    tumAdaylar = tumAdaylar.sort(() => Math.random() - 0.5);

    for (const haber of tumAdaylar.slice(0, 15)) {
      try {
        const { data: html } = await axios.get(haber.link, { 
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $d = cheerio.load(html);
        const img = $d('meta[property="og:image"]').attr('content') || "https://haberpik.com/logo.png";
        const text = $d('.haber_metni p, article p, .content p, .news-content p').map((_:any, p:any) => $d(p).text()).get().join('\n');

        if (text.length > 200) {
  const prompt = `Sen bir SEO uzmanısın. Aşağıdaki metinden özgün bir haber oluştur. 
  JSON yapısı ŞU ŞEKİLDE OLSUN (BAŞKA METİN YAZMA):
  {
    "baslik": "haber başlığı",
    "ozet": "kısa özet",
    "icerik": "detaylı haber içeriği",
    "seo_kelimeler": "anahtar kelime 1, anahtar kelime 2, anahtar kelime 3",
    "meta_aciklama": "Google arama sonucu açıklaması",
    "durum": "aktif"
  }`;
  
  const result = await model.generateContent([prompt, text]);
  const responseText = result.response.text();
  const cleanData = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0] || "{}");

  if (cleanData.baslik) {
  const finalKategoriler = kategoriEsle(haber.rssKategorisi, haber.kaynak, cleanData.baslik);
  
  // --- SLIDER VE VİTRİN KONTROLLERİ (Yeni Kategori Sihirbazına Tam Uyumlu) ---
  
  // 1. Ana Slider: Sadece Kocaeli (ANASLIDER) haberleri girer
  const isAnaSlider = finalKategoriler.includes("ANASLIDER");
  
  // 2. Spor Slider: Sadece Ulusal Spor (SPOR) haberleri girer
  const isSporSlider = finalKategoriler.includes("SPOR");
  
  // 3. Dörtlü Alt Sliderlar: Türkiye, Dünya, Siyaset, Asayiş
  const isTurkiyeSlider = finalKategoriler.includes("TÜRKİYE HABERLERİ");
  const isDunyaSlider = finalKategoriler.includes("DÜNYA");
  const isSiyasetSlider = finalKategoriler.includes("SİYASET");
  const isAsayisSlider = finalKategoriler.includes("ASAYİŞ");

  // Haber bu kategorilerden herhangi birine sahipse slider listesine girsin kanka
  const girmeliMi = isAnaSlider || isSporSlider || isTurkiyeSlider || isDunyaSlider || isSiyasetSlider || isAsayisSlider;

  await addDoc(collection(db, "haberler"), {
    ...cleanData, 
    kategoriler: finalKategoriler,
    kategori: finalKategoriler[0] || (haber.kaynak === 'Çağdaş Kocaeli' ? 'GÜNDEM' : 'TÜRKİYE HABERLERİ'),
    
    // SEO ve Meta Verileri (Boş gelirse özetle dolduruyoruz)
    seo_kelimeler: cleanData.seo_kelimeler || cleanData.anahtar_kelimeler || "", 
    meta_aciklama: cleanData.meta_aciklama || cleanData.ozet || "",

    // --- VİTRİN MÜHÜRLERİ ---
    mansetEkle: girmeliMi,
    sliderEkle: girmeliMi,
    
    // Dörtlü yapı ve Gündem Özeti için frontend'in baktığı ekstra bayraklar (isteğe bağlı)
    isGundemOzet: finalKategoriler.includes("GÜNDEM"), // Kocaeli Gündem Özeti için
    
    resim: img,
    kaynak: haber.link,
    kaynak_ad: haber.kaynak,
    tarih: new Date(),
    yazar: "HaberPik Bot",
    okunma: 0
  });

  console.log(`✅ SEO Dahil Eklendi: ${cleanData.baslik} [${finalKategoriler.join(", ")}]`);
  sayac++;
}
}
      } catch (err) { console.log(`❌ Hata: ${haber.link}`); }
    }
    return NextResponse.json({ mesaj: "HaberPik Operasyonu Başarılı!", eklenen: sayac });
  } catch (e: any) {
    return NextResponse.json({ hata: e.message });
  }
}