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
  
  // 1. KOCAELİ KUTSAL BÖLGESİ (Sadece Çağdaş Kocaeli sızabilir)
  if (kaynak === 'Çağdaş Kocaeli') {
    katlar.push('GÜNDEM'); 
    katlar.push('ANASLIDER'); // En üstteki Kocaeli Slider'ı sadece yerel olur

    // Yerel Spor Ayrımı: Sütunlara gider
    if (k.includes('SPOR') || k.includes('KOCAELİSPOR')) {
      katlar.push('YEREL SPOR');
    }
    // Yerel Yaşam -> Hayatın İçinden
    if (k.includes('YAŞAM') || k.includes('MAGAZİN')) {
      katlar.push('HAYATIN İÇİNDEN');
    }
  } else {
    // 2. ULUSAL BÖLGE (RSS Kaynağına Sadakat)
    // RSS'den ne gelirse o havuza düşer
    const rssKat = anaKategori.toUpperCase().trim();
    katlar.push(rssKat === 'TÜRKİYE' ? 'TÜRKİYE HABERLERİ' : rssKat);
  }

  // 3. İSTİSNAİ ÇOKLU KATEGORİ (Sadece Türkiye Haberleri veya Gündem içinden süzülür)
  // Bir haber Türkiye Haberi veya Gündem olsa bile içinde özel konu varsa oraya da kopyalanır
  if (katlar.includes('TÜRKİYE HABERLERİ') || katlar.includes('GÜNDEM')) {
    if (k.includes('OTOMOBİL') || k.includes('ARABA') || k.includes('TOGG')) katlar.push('OTOMOBİL');
    if (k.includes('SAĞLIK') || k.includes('HASTANE') || k.includes('DOKTOR')) katlar.push('SAĞLIK');
    if (k.includes('EĞİTİM') || k.includes('OKUL') || k.includes('SINAV')) katlar.push('EĞİTİM');
    if (k.includes('EMLAK') || k.includes('KONUT') || k.includes('TOKİ')) katlar.push('EMLAK');
    if (k.includes('EKONOMİ') || k.includes('BORSA') || k.includes('ALTIN')) katlar.push('EKONOMİ');
  }

  // 4. SPOR DİSİPLİNİ: Ulusal Spor asla Türkiye Haberleri'ne sızmaz, sadece kendi Slider'ına gider.
  if (katlar.includes('SPOR')) {
    return ['SPOR']; // Spor haberi sadece spordur kanka
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
            
            const isAnaSlider = finalKategoriler.includes("ANASLIDER");
            const isSporSlider = finalKategoriler.includes("SPOR");
            const isTurkiyeSlider = finalKategoriler.includes("TÜRKİYE HABERLERİ");

            await addDoc(collection(db, "haberler"), {
      ...cleanData, // AI'dan gelen seo_kelimeler ve meta_aciklama burada içeri giriyor
      kategoriler: finalKategoriler,
      kategori: finalKategoriler[0],
      
      // GARANTİ MÜHÜRÜ: Eğer AI bazen alanı boş geçerse diye manuel zorlama
      seo_kelimeler: cleanData.seo_kelimeler || cleanData.anahtar_kelimeler || "", 
      meta_aciklama: cleanData.meta_aciklama || cleanData.ozet || "",

      // ... (Diğer slider/tarih ayarların aynı kalsın) ...
      mansetEkle: isAnaSlider || isSporSlider || isTurkiyeSlider,
      sliderEkle: isAnaSlider || isSporSlider || isTurkiyeSlider,
      resim: img,
      kaynak: haber.link,
      kaynak_ad: haber.kaynak,
      tarih: new Date(),
      yazar: "HaberPik Bot",
      okunma: 0
    });
    console.log(`✅ SEO Dahil Eklendi: ${cleanData.baslik}`);
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