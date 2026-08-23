'use strict';
/**
 * MXBankDictionary —— 墨西哥银行/商户专有词词典（V3 语音增强 · 第一轮①）
 *
 * 问题：普通话 ASR（Whisper/WebSpeech）把 BBVA / Banorte / Santander 听成中文近音词，
 * 纯编辑距离无法解决（"桑坦德" → Santander 距离过大）。
 *
 * 本词典为每家银行建立多维名称：
 *   canonical  标准名（存账户）
 *   names      西语/英文官方名
 *   aliases    常见变体/简写/西语叫法
 *   chinese    普通话用户可能说出的中文音译/叫法
 *   pinyin     中文叫法的拼音（用于拼音匹配："桑坦德" → sangtande → Santander）
 *   asrErrors  ASR 常见误识（用户实际说出后 ASR 输出的词）
 *
 * 解析由 BankResolver 负责（exact/alias/中文/拼音/模糊/上下文 多策略评分）。
 */
(function (global) {
  const BANKS = [
    {
      id: 'bbva', canonical: 'BBVA', type: 'bank',
      names: ['BBVA', 'BBVA México', 'BBVA Mexico'],
      aliases: ['BBVA银行', 'banco bbva', 'BB-VA', 'B B V A'],
      chinese: ['贝贝瓦', '比比瓦', '比巴', '贝巴', '必备啊', '贝贝啊', '必必瓦', '比维'],
      pinyin: ['beibeiva', 'bibiva', 'biba', 'beiba', 'bibeiwa', 'beibeia', 'biwei'],
      asrErrors: ['BBA', 'BVA', 'BVVA', 'BB', 'BA', 'B B A'],
    },
    {
      id: 'banorte', canonical: 'Banorte', type: 'bank',
      names: ['Banorte', 'Banorte México', 'Banorte Mexico'],
      aliases: ['Banorte银行', 'ban norte', 'banorte banco', 'BANORTE'],
      chinese: ['班诺特', '巴诺特', '班诺', '巴诺', '班诺得', '班诺特银行'],
      pinyin: ['bannuote', 'banuote', 'banno', 'banuo', 'bannuode'],
      asrErrors: ['banorte', 'bannote', 'banort', 'bannorte'],
    },
    {
      id: 'santander', canonical: 'Santander', type: 'bank',
      names: ['Santander', 'Banco Santander'],
      aliases: ['Santander银行', 'santa n', 'santander banco'],
      chinese: ['桑坦德', '桑坦得', '桑丹德', '三坦德', '桑坦戴', '桑坦德银行', '桑坦'],
      pinyin: ['sangtande', 'sangtande', 'sangdande', 'santande', 'sangtandai', 'sangtan'],
      asrErrors: ['Santa', 'santader', 'sandander', 'santender'],
    },
    {
      id: 'hsbc', canonical: 'HSBC', type: 'bank',
      names: ['HSBC', 'HSBC México', 'HSBC Mexico'],
      aliases: ['H S B C', 'HSBC银行'],
      chinese: ['汇丰', '汇丰银行', '埃奇艾斯比西', '艾尺艾斯比西'],
      pinyin: ['huifeng', 'huifengyinhang', 'aiqiaisibixi'],
      asrErrors: ['HSB', 'HSBC', 'h s b c', 'ASBC'],
    },
    {
      id: 'scotiabank', canonical: 'Scotiabank', type: 'bank',
      names: ['Scotiabank', 'Scotiabank México', 'Scotiabank Mexico'],
      aliases: ['Scotiabank银行', 'scotia', 'scotia bank'],
      chinese: ['斯科夏', '斯科特', '苏格夏', '斯科夏银行', '斯科西亚'],
      pinyin: ['sikexia', 'sikete', 'sugexia', 'sikexiya'],
      asrErrors: ['scotiabank', 'scotia bank', 'scotabank', 'scotiabanc'],
    },
    {
      id: 'banamex', canonical: 'Citibanamex', type: 'bank',
      names: ['Citibanamex', 'Banamex', 'Citibanamex México'],
      aliases: ['Citibanamex银行', 'banamex', 'citibanamex'],
      chinese: ['花旗', '花旗银行', '巴纳梅克斯', '西提银行'],
      pinyin: ['huaqi', 'huaqiyinhang', 'banameikesi', 'xiti'],
      asrErrors: ['banamex', 'citibanamex', 'citibaname', 'bananex'],
    },
    {
      id: 'azteca', canonical: 'Banco Azteca', type: 'bank',
      names: ['Banco Azteca', 'Banco Azteca México'],
      aliases: ['Azteca', 'banco azteca'],
      chinese: ['阿兹特克', '阿兹特克银行', '阿斯特卡', '阿兹台克'],
      pinyin: ['aziteke', 'azitekeyinhang', 'asiteka', 'azitaike'],
      asrErrors: ['azteca', 'banco azteca', 'aztec'],
    },
    {
      id: 'bajio', canonical: 'Banco del Bajío', type: 'bank',
      names: ['Banco del Bajío', 'Banco del Bajio', 'Bajío'],
      aliases: ['Bajio', 'del bajio'],
      chinese: ['巴希奥', '巴希奥银行', '德尔巴希奥'],
      pinyin: ['baxiao', 'baxiaoyinhang', 'deerbaxiao'],
      asrErrors: ['bajio', 'banco del bajio', 'baxio'],
    },
    {
      id: 'banregio', canonical: 'Banregio', type: 'bank',
      names: ['Banregio', 'Banregio México'],
      aliases: ['Banrejio', 'ban regio'],
      chinese: ['班雷吉奥', '班雷希奥', '班瑞吉奥'],
      pinyin: ['banleijiao', 'banleixiao', 'banruijiao'],
      asrErrors: ['banregio', 'banrejio', 'banrigio'],
    },
    {
      id: 'inbursa', canonical: 'Inbursa', type: 'bank',
      names: ['Inbursa', 'Banco Inbursa'],
      aliases: ['inbursa', 'banco inbursa'],
      chinese: ['因布尔萨', '因布尔萨银行', '因布萨'],
      pinyin: ['yinbuersa', 'yinbusa'],
      asrErrors: ['inbursa', 'imbursa', 'inbusa'],
    },
    {
      id: 'afirme', canonical: 'Afirme', type: 'bank',
      names: ['Afirme', 'Banco Afirme'],
      aliases: ['afirme', 'banco afirme'],
      chinese: ['阿菲尔梅', '阿菲梅', '阿菲尔'],
      pinyin: ['afeiermei', 'afeimei', 'afeier'],
      asrErrors: ['afirme', 'afirmee', 'afim'],
    },
    {
      id: 'mifel', canonical: 'Mifel', type: 'bank',
      names: ['Mifel', 'Banco Mifel'],
      aliases: ['mifel', 'banco mifel'],
      chinese: ['米菲尔', '米费尔', '米菲'],
      pinyin: ['mifeier', 'mifei'],
      asrErrors: ['mifel', 'mifle', 'miffel'],
    },
    {
      id: 'intercam', canonical: 'Intercam', type: 'bank',
      names: ['Intercam', 'Banco Intercam'],
      aliases: ['intercam', 'banco intercam'],
      chinese: ['因特坎', '因特卡姆', '国际坎'],
      pinyin: ['yintekan', 'yintekami', 'guojikan'],
      asrErrors: ['intercam', 'intercam', 'interkan'],
    },
    {
      id: 'actinver', canonical: 'Actinver', type: 'bank',
      names: ['Actinver', 'Banco Actinver'],
      aliases: ['actinver', 'banco actinver'],
      chinese: ['阿克丁维', '阿克提维', '阿克廷'],
      pinyin: ['akedingwei', 'aketiwei', 'aketing'],
      asrErrors: ['actinver', 'activer', 'actinver'],
    },
    {
      id: 'monex', canonical: 'Monex', type: 'bank',
      names: ['Monex', 'Banco Monex'],
      aliases: ['monex', 'banco monex'],
      chinese: ['莫内克斯', '莫内斯', '莫奈'],
      pinyin: ['moneikesi', 'moneisi', 'monai'],
      asrErrors: ['monex', 'moneyx', 'monix'],
    },
    {
      id: 'nu', canonical: 'Nu', type: 'bank',
      names: ['Nu', 'Nu México', 'Nu Mexico'],
      aliases: ['nu', 'nu bank'],
      chinese: ['努', '努银行', '牛'],
      pinyin: ['nu', 'niuyinhang'],
      asrErrors: ['nu', 'new', 'nue'],
    },
    {
      id: 'mercadopago', canonical: 'Mercado Pago', type: 'payment_platform',
      names: ['Mercado Pago', 'MercadoPago'],
      aliases: ['mercado pago', 'mercadopago', 'MP'],
      chinese: ['梅尔卡多帕戈', '梅卡多帕果', '美卡多帕戈', '墨卡多'],
      pinyin: ['meierkaduopage', 'meikaduopaguo', 'meikaduopage', 'mokaduo'],
      asrErrors: ['mercado pago', 'mercado pag', 'mercado'],
    },
    {
      id: 'caja', canonical: 'CAJA', type: 'bank',
      names: ['Caja Popular', 'Caja'],
      aliases: ['caja', 'caja popular', 'caja de ahorro'],
      chinese: ['卡哈', '卡哈储蓄', '储蓄社'],
      pinyin: ['kaha', 'kahachuxu'],
      asrErrors: ['caja', 'caha', 'caxa'],
    },
  ];

  const MERCHANTS = [
    {
      id: 'oxxo', canonical: 'OXXO', type: 'brand',
      names: ['OXXO'],
      aliases: ['oxxo', 'oxxo店', 'ocho'],
      chinese: ['奥乔', '欧克索', '奥克索'],
      pinyin: ['aoqiao', 'oukesuo', 'aokesuo'],
      asrErrors: ['oxxo', 'ocho', 'ojjo', 'oxo'],
    },
    {
      id: 'walmart', canonical: 'Walmart', type: 'brand',
      names: ['Walmart', 'Walmart México', 'Walmart Mexico'],
      aliases: ['wal mart', 'walmart超市'],
      chinese: ['沃尔玛', '沃尔玛超市'],
      pinyin: ['woerma', 'woermaochaoshi'],
      asrErrors: ['walmart', 'walamart', 'wallmart', '沃玛'],
    },
    {
      id: 'soriana', canonical: 'Soriana', type: 'brand',
      names: ['Soriana'],
      aliases: ['soriana', 'soriana超市'],
      chinese: ['索里亚纳', '索里安娜'],
      pinyin: ['suoliyana', 'suoliana'],
      asrErrors: ['soriana', 'sorina', 'soreana'],
    },
    {
      id: 'coppel', canonical: 'Coppel', type: 'brand',
      names: ['Coppel'],
      aliases: ['coppel', 'coppel店'],
      chinese: ['科佩尔', '科佩', '高佩尔'],
      pinyin: ['kepeier', 'kepei', 'gaopeier'],
      asrErrors: ['coppel', 'copel', 'copple'],
    },
    {
      id: 'sears', canonical: 'SEARS', type: 'brand',
      names: ['Sears', 'SEARS'],
      aliases: ['sears'],
      chinese: ['西尔斯', '西尔斯百货'],
      pinyin: ['xiersi'],
      asrErrors: ['sears', 'sires', 'seers'],
    },
    {
      id: '7eleven', canonical: '7-ELEVEN', type: 'brand',
      names: ['7-Eleven', '7-ELEVEN'],
      aliases: ['7 eleven', 'seven eleven', '7-11'],
      chinese: ['七十一', '七十一便利店', '七幺幺'],
      pinyin: ['qishiyi', 'qiyiyao'],
      asrErrors: ['seven eleven', 'seveneleven', '七十一'],
    },
    {
      id: 'aurrera', canonical: 'Bodega Aurrera', type: 'brand',
      names: ['Bodega Aurrera', 'Aurrera'],
      aliases: ['aurrera', 'bodega aurrera'],
      chinese: ['奥雷拉', '奥雷拉超市', '奥雷拉仓储'],
      pinyin: ['aoleila', 'aoleilachaoshi'],
      asrErrors: ['aurrera', 'aurera', 'aurera'],
    },
  ];

  // 归一化：小写 + 去空格/连字符/下划线/句点（"B B V A" / "BB-VA" → "bbva"）
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_./]/g, '');
  }

  /** 展平一个实体的所有候选词（names+aliases+chinese+pinyin+asrErrors → 归一化 Set） */
  function flattenCandidates(ent) {
    const set = new Set();
    const add = (s) => { const n = normalize(s); if (n) set.add(n); };
    (ent.names || []).forEach(add);
    (ent.aliases || []).forEach(add);
    (ent.chinese || []).forEach(add);
    (ent.pinyin || []).forEach(add);
    (ent.asrErrors || []).forEach(add);
    return set;
  }

  /** 全量候选词 → 实体 id 映射（不含用户词，用户词由 BankResolver 合并） */
  const CANDIDATE_INDEX = {};
  function buildIndex(list) {
    const idx = {};
    for (const ent of list) {
      for (const cand of flattenCandidates(ent)) idx[cand] = ent.id;
    }
    return idx;
  }
  const BANK_INDEX = buildIndex(BANKS);
  const MERCHANT_INDEX = buildIndex(MERCHANTS);
  const ALL_BANKS = BANKS;
  const ALL_MERCHANTS = MERCHANTS;

  global.MXBankDictionary = {
    banks: ALL_BANKS,
    merchants: ALL_MERCHANTS,
    getBankIndex: () => BANK_INDEX,
    getMerchantIndex: () => MERCHANT_INDEX,
    getBankById: (id) => ALL_BANKS.find(b => b.id === id) || null,
    getMerchantById: (id) => ALL_MERCHANTS.find(m => m.id === id) || null,
    normalize,
    flattenCandidates,
  };
})(typeof window !== 'undefined' ? window : globalThis);
