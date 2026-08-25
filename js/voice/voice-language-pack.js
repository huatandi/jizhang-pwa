'use strict';
/**
 * VoiceLanguagePack V1
 * Global command vocabulary for Voice Draft Session.
 * Region and language are intentionally separate: this module only handles language-level commands.
 */
(function (global) {
  const PACKS = {
    zh: {
      commit: ['结束','完毕','完成','好了','好啦','可以了','就这样','保存草稿','结束录音'],
      cancel: ['取消','取消这次','不要了','作废','全部取消'],
      clear: ['清空','全部清空','清除全部','重新开始'],
      undo: ['撤销','撤销刚才','退回一步','上一步'],
      redo: ['恢复','重做','恢复刚才'],
      deleteLast: ['删除上一句','删掉上一句','上一句不要','最后一句不要','删除最后一句'],
      replaceLast: ['重说上一句','重新说上一句','上一句重来'],
    },
    es: {
      commit: ['listo','terminé','termine','terminado','finalizar','hecho','eso es todo','guardar borrador'],
      cancel: ['cancelar','cancela esto','anular','olvídalo','olvidalo'],
      clear: ['borrar todo','limpiar todo','empezar de nuevo'],
      undo: ['deshacer','deshaz','volver atrás','volver atras'],
      redo: ['rehacer','repetir cambio'],
      deleteLast: ['borra la última frase','borra la ultima frase','quita la última frase','quita la ultima frase'],
      replaceLast: ['repite la última frase','repite la ultima frase','vuelvo a decir la última','vuelvo a decir la ultima'],
    },
    en: {
      commit: ['done','finished','complete','that is all',"that's all",'finish recording','save draft'],
      cancel: ['cancel','cancel this','discard','forget it'],
      clear: ['clear all','clear everything','start over'],
      undo: ['undo','undo that','go back'],
      redo: ['redo','redo that'],
      deleteLast: ['delete last sentence','remove last sentence','delete the last line'],
      replaceLast: ['repeat last sentence','replace last sentence','say last sentence again'],
    },
  };

  function baseLang(locale) {
    const x = String(locale || '').toLowerCase();
    if (x.startsWith('zh')) return 'zh';
    if (x.startsWith('es')) return 'es';
    return 'en';
  }

  function norm(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[，。！？、；：,.!?;:]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  function exactMatch(text, list) {
    const n = norm(text);
    return (list || []).some(x => n === norm(x));
  }

  function interpret(text, locale) {
    const pack = PACKS[baseLang(locale)] || PACKS.en;
    if (exactMatch(text, pack.commit)) return { type: 'COMMIT', confidence: 0.99 };
    if (exactMatch(text, pack.cancel)) return { type: 'CANCEL', confidence: 0.99 };
    if (exactMatch(text, pack.clear)) return { type: 'CLEAR', confidence: 0.98 };
    if (exactMatch(text, pack.undo)) return { type: 'UNDO', confidence: 0.98 };
    if (exactMatch(text, pack.redo)) return { type: 'REDO', confidence: 0.98 };
    if (exactMatch(text, pack.deleteLast)) return { type: 'DELETE_LAST', confidence: 0.97 };
    if (exactMatch(text, pack.replaceLast)) return { type: 'REPLACE_LAST', confidence: 0.97 };
    return { type: 'CONTENT', confidence: 0.8 };
  }

  global.VoiceLanguagePack = { PACKS, baseLang, norm, interpret };
})(typeof window !== 'undefined' ? window : globalThis);
