/* ZIP import adapter. JSZip 3.x is bundled locally; no network/server required. */
(function (g) {
  'use strict';
  var LIMIT = 6 * 1024 * 1024, COUNT = 256;
  var crcTable = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ crcTable[(c ^ bytes[i]) & 255];
    return (c ^ -1) >>> 0;
  }
  function hidden(path) {
    return path.split('/').some(function (part) { return part === '__MACOSX' || part === '.DS_Store' || part.indexOf('._') === 0; });
  }
  async function read(file) {
    if (!g.JSZip) throw new Error('ZIP组件未加载，请检查 assets/vendor/jszip.min.js');
    if (file.size > 12 * 1024 * 1024) throw new Error('ZIP文件超过12 MB，请每个案例单独打包；解压后上限6 MB');
    var archive = await g.JSZip.loadAsync(await file.arrayBuffer());
    var entries = Object.keys(archive.files).map(function (key) { return archive.files[key]; });
    if (entries.length > COUNT) throw new Error('ZIP条目过多，最多256项');
    var files = [], paths = new Set(), total = 0;
    entries.forEach(function (entry) {
      var name = entry.unsafeOriginalName || entry.name;
      if (/\\|^\/|^[a-z]:|\x00/i.test(name) || name.split('/').some(function (x) { return x === '..' || x === '.'; })) throw new Error('ZIP含不安全路径：' + name);
      if (entry.dir || hidden(name)) return;
      if (entry.unixPermissions && (entry.unixPermissions & 61440) === 40960) throw new Error('ZIP不支持符号链接：' + name);
      if (paths.has(name)) throw new Error('ZIP含重复文件路径：' + name);
      paths.add(name);
      var size = entry._data && entry._data.uncompressedSize;
      if (!Number.isSafeInteger(size) || size < 0 || size > LIMIT) throw new Error('ZIP文件尺寸无效或过大：' + name);
      total += size;
      if (total > LIMIT) throw new Error('解压后总大小超过6 MB，请压缩图片或精简素材');
      files.push({ entry: entry, name: name, size: size });
    });
    if (!files.length) throw new Error('ZIP中没有可导入文件');
    var manifests = files.filter(function (f) { return /(^|\/)(case|[a-z0-9._-]+\.case)\.json$/i.test(f.name); });
    if (manifests.length !== 1) throw new Error(manifests.length ? 'ZIP包含多个案例清单，请一个案例一个压缩包，逐个导入' : 'ZIP中未找到 case.json 或 *.case.json 清单');
    var manifest = manifests[0], slash = manifest.name.lastIndexOf('/'), root = slash < 0 ? '' : manifest.name.slice(0, slash + 1);
    var out = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (root && f.name.indexOf(root) !== 0) continue;
      var bytes = await f.entry.async('uint8array');
      if (bytes.length !== f.size || crc32(bytes) !== (f.entry._data.crc32 >>> 0)) throw new Error('ZIP内容损坏或校验失败：' + f.name);
      var path = f.name.slice(root.length);
      var result = new File([bytes], path.split('/').pop(), {type: ''});
      Object.defineProperty(result, 'webkitRelativePath', {value: path});
      out.push(result);
    }
    return out;
  }
  g.CaseZip = { read: read };
})(window);
