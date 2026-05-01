require('dotenv').config();
const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [
      ['image', 'image'],
      ['media:content', 'media:content'],
      ['enclosure', 'enclosure']
    ]
  }
});
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, serverTimestamp } = require('firebase/firestore');
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const RSS_SOURCES = [
    { kat: 'KOCAELİ GÜNDEMİ', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss', type: 'YEREL' },
    { kat: 'ASAYİŞ', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss/asayis', type: 'YEREL' },
    { kat: 'SİYASET', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss/siyaset', type: 'YEREL' },
    { kat: 'GÜNDEM', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss/gundem', type: 'YEREL' },
    { kat: 'SPOR', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss/spor', type: 'YEREL_SPOR' },
    { kat: 'SON DAKİKA', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/all/news', type: 'SON_DAKIKA' },
    { kat: 'SON DAKİKA', kaynak: 'Özgün Kocaeli', url: 'https://www.ozgunkocaeli.com.tr/rss/son-dakika', type: 'SON_DAKIKA' },
    { kat: 'SPOR', kaynak: 'A Haber Spor', url: 'https://www.ahaber.com.tr/rss/spor.xml', type: 'ULUSAL' },
    { kat: 'EKONOMİ', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/ekonomi.xml', type: 'ULUSAL' },
    { kat: 'MAGAZİN', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/magazin.xml', type: 'ULUSAL' },
    { kat: 'HAYATIN İÇİNDEN', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/yasam.xml', type: 'ULUSAL' },
    { kat: 'OTOMOBİL', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/otomobil.xml', type: 'ULUSAL' },
    { kat: 'BİLİM TEKNOLOJİ', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/teknoloji.xml', type: 'ULUSAL' },
    { kat: 'SAĞLIK', kaynak: 'A Haber', url: 'https://www.ahaber.com.tr/rss/saglik.xml', type: 'ULUSAL' },
    { kat: 'KÜLTÜR SANAT', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/kultur-sanat/news', type: 'ULUSAL' },
    { kat: 'DÜNYA', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/dunya/news', type: 'ULUSAL' },
    { kat: 'EĞİTİM', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/egitim/news', type: 'ULUSAL' },
    { kat: 'TÜRKİYE HABERLERİ', kaynak: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/turkiye/news', type: 'ULUSAL' }    
];

async function haberBotu() {
    console.log(`🚀 [${new Date().toLocaleTimeString()}] Tarama başladı...`);
    let yeniCount = 0;

    for (const source of [...RSS_SOURCES].reverse()) {
        try {
            const feed = await parser.parseURL(source.url);
            // --- 1. CERRAHİ DOKUNUŞ: BENZERSİZ ID VE AKILLI PROMPT ---
for (const item of feed.items) {
    // KANKA: ID çakışmasını kökten bitiriyoruz. 
    // Link yerine rastgele benzersiz ID (addDoc mantığı gibi) veya link+zaman damgası kullanıyoruz.
    const haberId = Buffer.from(item.link + new Date().getTime()).toString('base64').replace(/[/+=]/g, '').substring(0, 50);
    const haberRef = doc(db, 'haberler', haberId);
    
    // Zaten kayıtlıysa geç (Zaman damgası eklediğimiz için her taramada yeni ID alır, 
    // eğer link bazlı kontrol istersen linki sabit tutabilirsin ama "farklı ID" istediğin için bu en temizi)
    const docCheck = await getDoc(haberRef);
    if (docCheck.exists()) continue;

    const prompt = `Sen profesyonel bir haber editörüsün. SADECE JSON dön.
    Haber: ${item.title}
    Özet: ${item.contentSnippet}
    Kaynak: ${source.kaynak}
    
    KURALLAR:
    1. "icerik": Haberi en az 4-5 paragraflık, profesyonel ve detaylı bir dille YENİDEN YAZ.
    2. "kategoriler": RSS'ten gelen "${source.kat}" kategorisini ana kategori al, yanına uygun 1-2 tane daha ekle.
    3. "mansetEkle", "trendEkle", "sonDakika": Haberin değerine göre (Çok önemliyse) true yap.
    4. "sliderEkle": BU KRİTİK! Eğer kategori "SPOR" veya "YEREL SPOR" DEĞİLSE bunu MUTLAKA true yap. Spor haberlerinde sadece çok büyük olaylarda true yap.
    5. "anaSayfaDuzen": Haber yerelse "KOCAELİ_BOLUMU", spor ise "SPORPIK_SLIDER", diğerleri "ANA_SLIDER" yap.
    6. "resimOnay": Haberin orijinal resmini (varsa) incele. Eğer üzerinde CNN, A Haber, İHA, özgün kocaeli gibi başka sitelerin logoları, büyük filigranları veya kurumsal mühürleri varsa false, resim temizse true dön.
    JSON formatı: { "baslik": "...", "ozet": "...", "icerik": "...", "kategoriler": [], "anaSayfaDuzen": "...", "sonDakika": false, "sliderEkle": false, "trendEkle": false, "mansetEkle": false, "seo_kelimeler": "...", "meta_aciklama": "..." }`;

                const result = await model.generateContent(prompt);
                const resText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                // --- 2. CERRAHİ DOKUNUŞ: AKILLI MÜHÜRLEME SİSTEMİ ---
const ai = JSON.parse(resText);

// --- YERELLİK SÜZGECİ: Ulusal haberlerin Kocaeli'ye sızmasını engeller ---
if (source.type === 'ULUSAL' || source.type === 'SON_DAKIKA') {
    // Kanka, eğer kaynak ulusalsa kategorilerden Kocaeli ile ilgili olanları ayıklıyoruz
    ai.kategoriler = ai.kategoriler.filter(k => 
        !k.toUpperCase('tr-TR').includes("KOCAELİ") && 
        !k.toUpperCase('tr-TR').includes("YEREL")
    );
    
    // Eğer Gemini anaSayfaDuzen'i yanlışlıkla yerel bölüme attıysa düzeltiyoruz
    if (ai.anaSayfaDuzen === "KOCAELİ_BOLUMU") {
        ai.anaSayfaDuzen = "ANA_SLIDER";
    }
}

const mühür = {
    baslik: ai.baslik || item.title,
    ozet: ai.ozet || "",
    icerik: ai.icerik || "", 
    // --- RESİM DEDEKTÖRÜ VE VARSAYILAN LOGO MÜHÜRÜ ---
// --- RESİM DEDEKTÖRÜ: GARANTİCİ VE MÜHÜRLÜ VERSİYON ---
resim: (() => {
    // 1. RSS Standart Alanlarını Daha Geniş Tara
    let img = item.image || 
              item.enclosure?.url || 
              item['media:content']?.url || 
              item['media:content']?.$?.url; 
    
    // 2. Geçersiz Linkleri ve Placeholder'ları Temizle
    if (!img || typeof img !== 'string' || img.includes('placeholder') || img.includes('pixel.gif')) {
        img = null;
    }

    // 3. RSS'de Yoksa İçerik ve Açıklamayı Derinlemesine Tara (Regex)
    if (!img) {
        const contentStr = (item.content || "") + " " + (item.description || "") + " " + (item['content:encoded'] || "");
        const regexMatch = contentStr.match(/<img[^>]+src="([^">]+)"/i);
        
        if (regexMatch && regexMatch[1] && !regexMatch[1].includes('placeholder')) {
            img = regexMatch[1];
        }
    }

    // --- KANKA: İŞTE BURASI YENİ EKLEDİĞİMİZ CERRAHİ DOKUNUŞ ---
    // Eğer Gemini "Bu resimde logo var" (resimOnay: false) dediyse, 
    // link bulsak bile onu siliyoruz ki aşağıda "SON KALE" devreye girsin.
    if (ai.resimOnay === false) {
        img = null;
    }
    // -------------------------------------------------------

    // 4. SON KALE: Eğer hala resim yoksa (veya logo nedeniyle sildiysek) senin logoları çak
    if (!img) {
        const isSonDakika = source.type === 'SON_DAKIKA' || source.kat.toUpperCase('tr-TR').includes("SON DAKİKA");
        if (isSonDakika) {
            return "https://firebasestorage.googleapis.com/v0/b/kocaelihaber-e779e.firebasestorage.app/o/son%20dakika.png?alt=media&token=4c12d38a-96a5-4c60-b355-8176c2be9f99";
        } else {
            return "https://firebasestorage.googleapis.com/v0/b/kocaelihaber-e779e.firebasestorage.app/o/resimsiz%20haberlericin.png?alt=media&token=be1f8d44-e0ea-4097-b4c5-4a2490086ac6";
        }
    }

    return img;
})(),

    // KANKA: Kategori mühürleme artık vitrinlere otomatik düşecek şekilde büyük harf!
    kategoriler: Array.isArray(ai.kategoriler) ? ai.kategoriler.map(k => k.toUpperCase('tr-TR')) : [source.kat.toUpperCase('tr-TR')],
    kategori: source.kat.toUpperCase('tr-TR'),
    
    // KANKA: Senin "Spor Hariç Slider Olsun" kuralını mühürledik
    sliderEkle: (source.kat.toUpperCase('tr-TR').includes("SPOR")) 
        ? Boolean(ai.sliderEkle) // Sporsa Gemini karar versin
        : true, // Spor değilse (Siyaset, Ekonomi vb.) YAPIŞTIR Slider'a

    // Gemini'nin editoryal kararları
    mansetEkle: Boolean(ai.mansetEkle), 
    trendEkle: Boolean(ai.trendEkle),
    sonDakika: Boolean(ai.sonDakika || source.type === 'SON_DAKIKA'),
    
    anaSayfaDuzen: ai.anaSayfaDuzen || "ANA_SLIDER",
    tarih: serverTimestamp(),
    kaynak: source.kaynak,
    link: item.link,
    seo_kelimeler: ai.seo_kelimeler || "",
    meta_aciklama: ai.meta_aciklama || ""
};

await setDoc(haberRef, mühür);
                yeniCount++;
                console.log(`✅ Kaydedildi: [${mühür.kategori}] - ${mühür.baslik}`);
            }
        } catch (err) { console.log(`⚠️ Hata [${source.kat}]:`, err.message); }
    }
    console.log(`🏁 Tarama Bitti. Yeni: ${yeniCount} haber eklendi.`);
}

haberBotu();
setInterval(haberBotu, 30 * 60 * 1000);