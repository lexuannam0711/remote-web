function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFC').trim();
}

function foldVietnameseText(text) {
  return normalizeText(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const MAX_CUSTOMER_TAGS = 50;
const MAX_CUSTOMER_TAG_LENGTH = 100;

function normalizeVietnameseText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCustomerTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .slice(0, MAX_CUSTOMER_TAGS)
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, MAX_CUSTOMER_TAG_LENGTH))
    .filter(Boolean);
}

const VIETNAM_PROVINCES = [
  { name: 'Hà Nội', aliases: ['ha noi', 'hn', 'thu do'] },
  { name: 'Hồ Chí Minh', aliases: ['ho chi minh', 'hcm', 'tphcm', 'tp hcm', 'sai gon', 'sg'] },
  { name: 'Đà Nẵng', aliases: ['da nang', 'dn'] },
  { name: 'Hải Phòng', aliases: ['hai phong', 'hp'] },
  { name: 'Cần Thơ', aliases: ['can tho', 'ct'] },
  { name: 'An Giang', aliases: ['an giang'] },
  { name: 'Bà Rịa - Vũng Tàu', aliases: ['ba ria vung tau', 'vung tau', 'brvt', 'ba ria'] },
  { name: 'Bắc Giang', aliases: ['bac giang'] },
  { name: 'Bắc Kạn', aliases: ['bac kan', 'bac can'] },
  { name: 'Bạc Liêu', aliases: ['bac lieu'] },
  { name: 'Bắc Ninh', aliases: ['bac ninh'] },
  { name: 'Bến Tre', aliases: ['ben tre'] },
  { name: 'Bình Định', aliases: ['binh dinh', 'quy nhon'] },
  { name: 'Bình Dương', aliases: ['binh duong', 'thu dau mot'] },
  { name: 'Bình Phước', aliases: ['binh phuoc', 'dong xoai'] },
  { name: 'Bình Thuận', aliases: ['binh thuan', 'phan thiet'] },
  { name: 'Cà Mau', aliases: ['ca mau'] },
  { name: 'Cao Bằng', aliases: ['cao bang'] },
  { name: 'Đắk Lắk', aliases: ['dak lak', 'daklak', 'dac lac', 'buon ma thuot', 'bmt'] },
  { name: 'Đắk Nông', aliases: ['dak nong', 'daknong', 'dac nong'] },
  { name: 'Điện Biên', aliases: ['dien bien', 'dien bien phu'] },
  { name: 'Đồng Nai', aliases: ['dong nai', 'bien hoa'] },
  { name: 'Đồng Tháp', aliases: ['dong thap', 'cao lanh', 'sa dec'] },
  { name: 'Gia Lai', aliases: ['gia lai', 'pleiku'] },
  { name: 'Hà Giang', aliases: ['ha giang'] },
  { name: 'Hà Nam', aliases: ['ha nam', 'phu ly'] },
  { name: 'Hà Tĩnh', aliases: ['ha tinh'] },
  { name: 'Hải Dương', aliases: ['hai duong'] },
  { name: 'Hậu Giang', aliases: ['hau giang', 'vi thanh'] },
  { name: 'Hòa Bình', aliases: ['hoa binh'] },
  { name: 'Hưng Yên', aliases: ['hung yen'] },
  { name: 'Khánh Hòa', aliases: ['khanh hoa', 'nha trang', 'cam ranh'] },
  { name: 'Kiên Giang', aliases: ['kien giang', 'rach gia', 'phu quoc'] },
  { name: 'Kon Tum', aliases: ['kon tum', 'kontum'] },
  { name: 'Lai Châu', aliases: ['lai chau'] },
  { name: 'Lâm Đồng', aliases: ['lam dong', 'da lat', 'bao loc'] },
  { name: 'Lạng Sơn', aliases: ['lang son'] },
  { name: 'Lào Cai', aliases: ['lao cai', 'sa pa', 'sapa'] },
  { name: 'Long An', aliases: ['long an', 'tan an'] },
  { name: 'Nam Định', aliases: ['nam dinh'] },
  { name: 'Nghệ An', aliases: ['nghe an', 'vinh'] },
  { name: 'Ninh Bình', aliases: ['ninh binh'] },
  { name: 'Ninh Thuận', aliases: ['ninh thuan', 'phan rang'] },
  { name: 'Phú Thọ', aliases: ['phu tho', 'viet tri'] },
  { name: 'Phú Yên', aliases: ['phu yen', 'tuy hoa'] },
  { name: 'Quảng Bình', aliases: ['quang binh', 'dong hoi'] },
  { name: 'Quảng Nam', aliases: ['quang nam', 'tam ky', 'hoi an'] },
  { name: 'Quảng Ngãi', aliases: ['quang ngai'] },
  { name: 'Quảng Ninh', aliases: ['quang ninh', 'ha long', 'cam pha', 'uong bi'] },
  { name: 'Quảng Trị', aliases: ['quang tri', 'dong ha'] },
  { name: 'Sóc Trăng', aliases: ['soc trang'] },
  { name: 'Sơn La', aliases: ['son la'] },
  { name: 'Tây Ninh', aliases: ['tay ninh'] },
  { name: 'Thái Bình', aliases: ['thai binh'] },
  { name: 'Thái Nguyên', aliases: ['thai nguyen'] },
  { name: 'Thanh Hóa', aliases: ['thanh hoa'] },
  { name: 'Thừa Thiên Huế', aliases: ['thua thien hue', 'hue', 'tth'] },
  { name: 'Tiền Giang', aliases: ['tien giang', 'my tho'] },
  { name: 'Trà Vinh', aliases: ['tra vinh'] },
  { name: 'Tuyên Quang', aliases: ['tuyen quang'] },
  { name: 'Vĩnh Long', aliases: ['vinh long'] },
  { name: 'Vĩnh Phúc', aliases: ['vinh phuc', 'vinh yen'] },
  { name: 'Yên Bái', aliases: ['yen bai'] }
];

const COMMON_DISTRICTS = [
  'cau giay', 'dong da', 'ba dinh', 'hoan kiem', 'thanh xuan', 'hai ba trung',
  'hoang mai', 'long bien', 'tay ho', 'nam tu liem', 'bac tu liem', 'ha dong',
  'son tay', 'soc son', 'dong anh', 'gia lam', 'thanh tri', 'me linh',
  'binh thanh', 'go vap', 'tan binh', 'tan phu', 'phu nhuan', 'binh tan',
  'thu duc', 'cu chi', 'hoc mon', 'binh chanh', 'nha be', 'can gio',
  'hai chau', 'thanh khe', 'son tra', 'ngu hanh son', 'lien chieu', 'cam le', 'hoa vang',
  'hong bang', 'ngo quyen', 'le chan', 'kien an', 'hai an', 'duong kinh', 'do son',
  'ninh kieu', 'binh thuy', 'cai rang', 'o mon', 'thot not',
  'buon ma thuot', 'da lat', 'nha trang', 'quy nhon', 'vinh', 'phan thiet', 'bien hoa'
];

// Deprecated stubs for returning customer policies (retained for backward compatibility)
function getEligibleReturningCustomerTags(_tags) {
  return [];
}

function getRepurchaseBlocker(_text, _options) {
  return null;
}

function detectExplicitRepurchase(_text) {
  return false;
}

function includesVietnameseKeyword(text, keywords) {
  const normalized = normalizeText(text);
  const folded = foldVietnameseText(text);
  return keywords.some((keyword) => normalized.includes(keyword) || folded.includes(foldVietnameseText(keyword)));
}

const ADDRESS_MAIN_MARKERS = ['thôn', 'xã', 'phường', 'huyện', 'tỉnh', 'thành phố'];
const ADDRESS_EXPLICIT_MARKERS = ['địa chỉ', 'đ/c', 'đc '];
const ADDRESS_CITY_ABBREVIATIONS = ['hn', 'hcm', 'tphcm', 'sg', 'hp'];

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAddressCityAbbreviation(text) {
  const folded = foldVietnameseText(text);
  return ADDRESS_CITY_ABBREVIATIONS.some((abbr) => new RegExp(`(^|[^a-z0-9])${escapeRegex(abbr)}($|[^a-z0-9])`).test(folded));
}

function getMainAddressMarkerHits(text) {
  return ADDRESS_MAIN_MARKERS.filter((marker) => includesVietnameseKeyword(text, [marker]));
}

function hasExplicitAddressMarker(text) {
  return includesVietnameseKeyword(text, ADDRESS_EXPLICIT_MARKERS);
}

// Detect messages that are NOT real customer text: empty, stickers, likes,
// reactions, photos/files-only, or pure links. These must never be treated as
// an address/phone (which would wrongly tag "Mua hàng" + mark unread).
function isNonTextMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;

  const s = normalizeText(raw);

  // Pancake/Facebook system snippets for non-text events.
  const systemSnippets = [
    'đã gửi một nhãn dán', 'da gui mot nhan dan', 'nhãn dán', 'nhan dan', 'sticker',
    'đã gửi một biểu tượng', 'biểu tượng cảm xúc', 'đã bày tỏ cảm xúc', 'bay to cam xuc',
    'đã gửi một ảnh', 'đã gửi ảnh', 'da gui anh', 'đã gửi một video', 'đã gửi video',
    'đã gửi một tệp', 'đã gửi tệp', 'đã gửi một file', 'gửi một đính kèm', 'đính kèm',
    'đã thích', 'đã thả tim', 'đã bày tỏ', 'sent a sticker', 'sent a photo',
    'sent an attachment', 'liked a message', 'reacted to'
  ];
  if (systemSnippets.some((k) => s.includes(k))) return true;

  // Pure emoji / icon only (no letters or digits at all).
  if (!/[a-z0-9à-ỹ]/i.test(raw)) return true;

  // A single "like" thumbs-up or short reaction.
  if (/^(👍|❤️|😂|😍|😮|😢|😡|\+1|like)$/i.test(raw)) return true;

  // Pure link: the whole message is essentially just a URL.
  const withoutUrls = raw.replace(/https?:\/\/\S+|www\.\S+/gi, '').trim();
  if (raw !== withoutUrls && withoutUrls.length === 0) return true;

  return false;
}

// Strip URLs out before phone/address detection so digits inside links
// (IDs, timestamps) don't get misread as a phone number.
function stripUrls(text) {
  return String(text || '').replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
}

function detectPhoneNumber(text) {
  const raw = stripUrls(text);
  const compact = raw.replace(/[^0-9]/g, '');
  const compactHit = /(?:^|[^0-9])(03|05|07|08|09)[0-9]{8}(?:$|[^0-9])/.test(compact);
  const separatedHit = /(?:^|\D)(0\s*[35789](?:[\s.\-]*\d){8})(?:\D|$)/.test(raw);
  return compactHit || separatedHit;
}

function detectFull3LevelAddress(text) {
  const raw = stripUrls(String(text || '')).trim();
  if (!raw || isNonTextMessage(raw)) {
    return { isFull3Level: false, level1: null, hasDistrict: false, hasCommune: false, rawAddress: '' };
  }

  const folded = foldVietnameseText(raw).replace(/[^a-z0-9\s,./-]/g, ' ').replace(/\s+/g, ' ');

  // 1. Detect Level 1 (Province)
  let foundProvince = null;
  for (const prov of VIETNAM_PROVINCES) {
    for (const alias of prov.aliases) {
      const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}($|[^a-z0-9])`, 'i');
      if (regex.test(folded)) {
        foundProvince = prov.name;
        break;
      }
    }
    if (foundProvince) break;
  }

  if (!foundProvince) {
    return { isFull3Level: false, level1: null, hasDistrict: false, hasCommune: false, rawAddress: raw };
  }

  // 2. Detect Level 2 (District)
  const hasDistrictMarker = /\b(?:quan|huyen|thi\s*xa|tx)\b/i.test(folded) ||
    /\b(?:tp|thanh\s*pho)\s+[a-z0-9]/i.test(folded) ||
    /\bq\.?\s*\d{1,2}\b/i.test(folded);

  const hasDistrictName = COMMON_DISTRICTS.some((d) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegex(d)}($|[^a-z0-9])`, 'i').test(folded)
  );
  const hasDistrict = Boolean(hasDistrictMarker || hasDistrictName);

  // 3. Detect Level 3 (Commune / Ward)
  const hasCommuneMarker = Boolean(
    /\b(?:xa|phuong|thi\s*tran|tt)\b/i.test(folded) ||
    /\bp\.?\s*\d{1,2}\b/i.test(folded)
  );

  // 4. Structured check (comma, dash, slash, or newline separated)
  const parts = raw.split(/[,;\n\r\t]+/).map((p) => p.trim()).filter(Boolean);
  const has3StructuredParts = parts.length >= 3;

  // Full 3-level requires province AND (both district & commune OR 3+ structured parts with district/commune)
  const isFull3Level = Boolean(
    foundProvince && (
      (hasDistrict && hasCommuneMarker) ||
      (has3StructuredParts && (hasDistrict || hasCommuneMarker))
    )
  );

  return {
    isFull3Level,
    level1: foundProvince,
    hasDistrict,
    hasCommune: hasCommuneMarker,
    rawAddress: raw
  };
}

function detectAddress(text) {
  const full = detectFull3LevelAddress(text);
  if (full.isFull3Level) return true;

  const raw = stripUrls(text);
  const mainHits = getMainAddressMarkerHits(raw);
  if (!mainHits.length) return false;
  if (mainHits.length >= 2) return true;
  if (hasAddressCityAbbreviation(raw)) return true;
  return hasExplicitAddressMarker(raw);
}

function detectPriceQuestion(text) {
  const s = normalizeText(text);
  return ['giá', 'bao nhiêu', 'nhiêu tiền', 'bn tiền', 'tiền', 'combo', 'liệu trình', 'mấy hộp'].some((k) => s.includes(k));
}

function detectGreeting(text) {
  const s = normalizeText(text);
  return /\b(hi|hello|chào|alo|shop|còn không|có không|tư vấn)\b/.test(s);
}

function detectShippingQuestion(text) {
  const s = normalizeText(text);
  return ['ship', 'vận chuyển', 'giao hàng', 'bao lâu', 'phí giao', 'phí ship', 'cod'].some((k) => s.includes(k));
}

function detectBuyIntent(text) {
  const s = normalizeText(text);
  return ['đặt', 'mua', 'lấy', 'chốt', 'lên đơn', 'gửi hàng', 'ship cho', 'đơn hàng', 'muốn dùng'].some((k) => s.includes(k));
}

function detectRefusal(text) {
  const s = normalizeText(text);
  return ['không mua', 'chưa mua', 'để sau', 'không cần', 'cảm ơn', 'đắt', 'suy nghĩ'].some((k) => s.includes(k));
}

function detectComplaint(text) {
  const s = normalizeText(text);
  return ['khiếu nại', 'lừa', 'hoàn tiền', 'không nhận', 'bực', 'tệ', 'chửi', 'sai hàng'].some((k) => s.includes(k));
}

// Extract a Vietnamese phone number, returning the digits or null.
function extractPhone(text) {
  const raw = stripUrls(text).replace(/[.\-\s]/g, '');
  const m = raw.match(/(0[35789]\d{8})/);
  return m ? m[1] : null;
}

// Extract a likely address span from free text.
function extractAddress(text) {
  const cleaned = stripUrls(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!cleaned || !detectAddress(cleaned)) return null;
  const lower = cleaned.toLowerCase();
  const folded = foldVietnameseText(cleaned);
  const markers = [...ADDRESS_EXPLICIT_MARKERS, ...ADDRESS_MAIN_MARKERS];
  let idx = -1;
  for (const mk of markers) {
    const at = lower.indexOf(mk);
    const foldedAt = folded.indexOf(foldVietnameseText(mk));
    const markerIdx = at >= 0 ? at : foldedAt;
    if (markerIdx >= 0 && (idx === -1 || markerIdx < idx)) idx = markerIdx;
  }
  if (idx === -1) {
    const full = detectFull3LevelAddress(cleaned);
    return full.isFull3Level ? cleaned : null;
  }
  // Take from the marker to the end, trimmed; strip a trailing phone if present.
  let span = cleaned.slice(idx).replace(/0[35789][\d.\-\s]{8,}/g, '').trim();
  return span || null;
}

function looksLikeRealAddress(address) {
  const s = normalizeText(address);
  if (!s || s.length < 6) return false;
  return detectAddress(address);
}

function extractContactInfo(text) {
  const phone = extractPhone(text);
  const address = extractAddress(text);
  const fullAddress = detectFull3LevelAddress(text);
  return {
    phone,
    address,
    phoneValid: Boolean(phone),
    addressValid: looksLikeRealAddress(address),
    full3Level: Boolean(fullAddress.isFull3Level),
    addressDetails: fullAddress,
    hasContact: Boolean(phone || address)
  };
}

function classifyMessage(text) {
  // Non-text events (sticker, like, photo-only, pure link, empty) must NOT be
  // misread as address/phone. Return a dedicated intent and skip detection.
  if (isNonTextMessage(text)) {
    return { intent: 'NON_TEXT', hasPhone: false, hasAddress: false, isFull3Level: false };
  }

  const fullAddress = detectFull3LevelAddress(text);
  const hasPhone = detectPhoneNumber(text);
  const hasAddress = fullAddress.isFull3Level || detectAddress(text);

  if (hasPhone && hasAddress) {
    return {
      intent: 'BUY_INTENT_HIGH',
      hasPhone,
      hasAddress,
      isFull3Level: fullAddress.isFull3Level,
      addressDetails: fullAddress
    };
  }
  if (hasPhone) {
    return {
      intent: 'PHONE_DETECTED',
      hasPhone,
      hasAddress,
      isFull3Level: fullAddress.isFull3Level,
      addressDetails: fullAddress
    };
  }
  if (hasAddress) {
    return {
      intent: 'ADDRESS_DETECTED',
      hasPhone,
      hasAddress,
      isFull3Level: fullAddress.isFull3Level,
      addressDetails: fullAddress
    };
  }

  if (detectComplaint(text)) return { intent: 'COMPLAINT', hasPhone, hasAddress, isFull3Level: false };
  if (detectPriceQuestion(text)) return { intent: 'PRICE_QUESTION', hasPhone, hasAddress, isFull3Level: false };
  if (detectShippingQuestion(text)) return { intent: 'SHIPPING_QUESTION', hasPhone, hasAddress, isFull3Level: false };
  if (detectBuyIntent(text)) return { intent: 'BUY_INTENT_LOW', hasPhone, hasAddress, isFull3Level: false };
  if (detectRefusal(text)) return { intent: 'REFUSAL', hasPhone, hasAddress, isFull3Level: false };
  if (detectGreeting(text)) return { intent: 'GREETING', hasPhone, hasAddress, isFull3Level: false };
  return { intent: 'UNKNOWN', hasPhone, hasAddress, isFull3Level: false };
}

module.exports = {
  MAX_CUSTOMER_TAGS,
  MAX_CUSTOMER_TAG_LENGTH,
  VIETNAM_PROVINCES,
  normalizeText,
  normalizeVietnameseText,
  sanitizeCustomerTags,
  getEligibleReturningCustomerTags,
  getRepurchaseBlocker,
  detectExplicitRepurchase,
  isNonTextMessage,
  stripUrls,
  detectPhoneNumber,
  detectFull3LevelAddress,
  detectAddress,
  extractPhone,
  extractAddress,
  looksLikeRealAddress,
  extractContactInfo,
  detectPriceQuestion,
  detectGreeting,
  detectShippingQuestion,
  detectBuyIntent,
  detectRefusal,
  detectComplaint,
  classifyMessage
};
