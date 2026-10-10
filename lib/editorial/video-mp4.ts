import { IntegrationError } from './integration-auth';

export const MAX_VIDEO_BYTES = 45 * 1024 * 1024;
type Box = { type: string; start: number; data: number; end: number };

/** Bounded ISO BMFF reader for the exact, non-fragmented FFmpeg export contract. */
export function inspectEditorialMp4(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES)
    throw new IntegrationError('Video vượt giới hạn 45 MB.');
  let boxCount = 0;
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    for (let offset = start; offset < end;) {
      if (++boxCount > 10000 || offset + 8 > end)
        throw new IntegrationError('Cấu trúc MP4 không hợp lệ.');
      let size = bytes.readUInt32BE(offset),
        header = 8;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > end) throw new IntegrationError('MP4 bị cắt.');
        const extended = bytes.readBigUInt64BE(offset + 8);
        if (extended > BigInt(MAX_VIDEO_BYTES))
          throw new IntegrationError('Box MP4 quá lớn.');
        size = Number(extended);
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end)
        throw new IntegrationError('MP4 bị cắt hoặc box sai kích thước.');
      result.push({
        type,
        start: offset,
        data: offset + header,
        end: offset + size,
      });
      offset += size;
    }
    return result;
  };
  const required = (list: Box[], type: string) => {
    const matches = list.filter((box) => box.type === type);
    if (matches.length !== 1)
      throw new IntegrationError('MP4 thiếu hoặc trùng box ' + type + '.');
    return matches[0];
  };
  const enough = (box: Box, size: number) => {
    if (box.data + size > box.end)
      throw new IntegrationError('MP4 thiếu metadata ' + box.type + '.');
  };
  const chunkRanges: { start: number; end: number }[] = [];
  const avcConfig = (box: Box) => {
    enough(box, 7);
    if (
      bytes[box.data] !== 1 ||
      bytes[box.data + 4] !== 0xff ||
      (bytes[box.data + 5] & 0xe0) !== 0xe0
    )
      throw new IntegrationError('Cấu hình H.264 không hợp lệ.');
    let position = box.data + 6;
    const nals = (count: number, type: number) => {
      if (!count) throw new IntegrationError('H.264 thiếu SPS/PPS.');
      for (let i = 0; i < count; i++) {
        if (position + 2 > box.end)
          throw new IntegrationError('Cấu hình H.264 bị cắt.');
        const length = bytes.readUInt16BE(position);
        position += 2;
        if (
          length < (type === 7 ? 4 : 2) ||
          position + length > box.end ||
          (bytes[position] & 0x80) !== 0 ||
          (bytes[position] & 31) !== type
        )
          throw new IntegrationError('Cấu hình H.264 bị cắt hoặc sai SPS/PPS.');
        position += length;
      }
    };
    nals(bytes[box.data + 5] & 31, 7);
    if (position >= box.end) throw new IntegrationError('H.264 thiếu PPS.');
    nals(bytes[position++], 8);
    if (position < box.end) {
      // High-profile avcC extension: chroma format, bit depths, SPS extensions.
      if (
        ![100, 110, 122, 144].includes(bytes[box.data + 1]) ||
        position + 4 > box.end ||
        (bytes[position] & 0xfc) !== 0xfc ||
        (bytes[position + 1] & 0xf8) !== 0xf8 ||
        (bytes[position + 2] & 0xf8) !== 0xf8
      )
        throw new IntegrationError('Phần mở rộng H.264 không hợp lệ.');
      position += 3;
      const count = bytes[position++];
      if (count) nals(count, 13);
    }
    if (position !== box.end)
      throw new IntegrationError('Cấu hình H.264 có dữ liệu thừa.');
  };
  type Descriptor = { tag: number; data: number; end: number };
  const descriptors = (start: number, end: number): Descriptor[] => {
    const result: Descriptor[] = [];
    let position = start;
    while (position < end) {
      if (result.length >= 128)
        throw new IntegrationError('Cấu hình AAC quá phức tạp.');
      const tag = bytes[position++];
      let length = 0,
        done = false;
      for (let i = 0; i < 4 && position < end; i++) {
        const value = bytes[position++];
        length = length * 128 + (value & 127);
        if (!(value & 128)) {
          done = true;
          break;
        }
      }
      if (!done || position + length > end)
        throw new IntegrationError('Cấu hình AAC bị cắt.');
      result.push({ tag, data: position, end: position + length });
      position += length;
    }
    return result;
  };
  const descriptor = (list: Descriptor[], tag: number) => {
    const found = list.filter((item) => item.tag === tag);
    if (found.length !== 1)
      throw new IntegrationError('Âm thanh thiếu cấu hình AAC.');
    return found[0];
  };
  const aacConfig = (box: Box, entry: Box) => {
    enough(box, 4);
    if (bytes.readUInt32BE(box.data) !== 0)
      throw new IntegrationError('Phiên bản cấu hình AAC không hỗ trợ.');
    const es = descriptor(descriptors(box.data + 4, box.end), 3);
    if (es.data + 3 > es.end)
      throw new IntegrationError('Cấu hình AAC bị cắt.');
    const flags = bytes[es.data + 2];
    let position = es.data + 3;
    if (flags & 0x80) position += 2;
    if (flags & 0x40) {
      if (position >= es.end)
        throw new IntegrationError('Cấu hình AAC bị cắt.');
      position += 1 + bytes[position];
    }
    if (flags & 0x20) position += 2;
    if (position > es.end) throw new IntegrationError('Cấu hình AAC bị cắt.');
    const decoder = descriptor(descriptors(position, es.end), 4);
    if (
      decoder.data + 13 > decoder.end ||
      bytes[decoder.data] !== 0x40 ||
      bytes[decoder.data + 1] >> 2 !== 5
    )
      throw new IntegrationError('Âm thanh cần codec AAC.');
    const config = descriptor(descriptors(decoder.data + 13, decoder.end), 5);
    if (config.data + 2 > config.end)
      throw new IntegrationError('Cấu hình AAC bị cắt.');
    let bit = config.data * 8;
    const readBits = (count: number) => {
      if (bit + count > config.end * 8)
        throw new IntegrationError('Cấu hình AAC bị cắt.');
      let value = 0;
      for (let i = 0; i < count; i++, bit++)
        value = value * 2 + ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
      return value;
    };
    if (readBits(5) !== 2)
      throw new IntegrationError('Âm thanh cần cấu hình AAC-LC.');
    const frequency = readBits(4);
    const rates = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000,
      11025, 8000, 7350,
    ];
    const rate = frequency === 15 ? readBits(24) : rates[frequency];
    const channels = readBits(4);
    if (
      !rate ||
      channels < 1 ||
      channels > 7 ||
      readBits(1) !== 0 ||
      readBits(1) !== 0 ||
      readBits(1) !== 0 ||
      bytes.readUInt32BE(entry.data + 24) / 65536 !== rate
    )
      throw new IntegrationError('Cấu hình AAC-LC không hợp lệ.');
  };
  const top = boxes(0, bytes.length);
  required(top, 'ftyp');
  const moov = required(top, 'moov'),
    mdat = required(top, 'mdat');
  if (moov.end > mdat.start || top.some((box) => box.type === 'moof'))
    throw new IntegrationError('Video cần MP4 faststart, không phân mảnh.');
  const tracks = boxes(moov.data, moov.end).filter(
    (box) => box.type === 'trak',
  );
  if (tracks.length !== 2)
    throw new IntegrationError(
      'Video cần đúng một track hình và một track âm thanh.',
    );
  const parsed = tracks.map((track) => {
    const children = boxes(track.data, track.end);
    const tkhd = required(children, 'tkhd'),
      mdia = required(children, 'mdia');
    const media = boxes(mdia.data, mdia.end);
    const mdhd = required(media, 'mdhd'),
      hdlr = required(media, 'hdlr');
    enough(mdhd, 4);
    enough(hdlr, 12);
    enough(tkhd, 4);
    const version = bytes[mdhd.data];
    if (version !== 0 && version !== 1)
      throw new IntegrationError('Phiên bản metadata MP4 không hỗ trợ.');
    const timeOffset = version === 1 ? 20 : 12;
    enough(mdhd, timeOffset + (version === 1 ? 12 : 8));
    const timescale = bytes.readUInt32BE(mdhd.data + timeOffset);
    const ticks =
      version === 1
        ? Number(bytes.readBigUInt64BE(mdhd.data + timeOffset + 4))
        : bytes.readUInt32BE(mdhd.data + timeOffset + 4);
    if (!timescale || !Number.isSafeInteger(ticks) || ticks <= 0)
      throw new IntegrationError('Thời lượng MP4 không hợp lệ.');
    const kind = bytes.toString('ascii', hdlr.data + 8, hdlr.data + 12);
    const minf = required(media, 'minf');
    const stbl = required(boxes(minf.data, minf.end), 'stbl');
    const sample = boxes(stbl.data, stbl.end);
    const stsd = required(sample, 'stsd');
    enough(stsd, 8);
    if (bytes.readUInt32BE(stsd.data + 4) !== 1)
      throw new IntegrationError('MP4 có nhiều codec trong một track.');
    const entry = required(
      boxes(stsd.data + 8, stsd.end),
      kind === 'vide' ? 'avc1' : 'mp4a',
    );
    if (kind === 'vide') {
      enough(entry, 78);
      const avc = required(boxes(entry.data + 78, entry.end), 'avcC');
      avcConfig(avc);
    } else if (kind === 'soun') {
      enough(entry, 28);
      const esds = required(boxes(entry.data + 28, entry.end), 'esds');
      aacConfig(esds, entry);
    } else throw new IntegrationError('Track MP4 không được hỗ trợ.');
    const stts = required(sample, 'stts');
    enough(stts, 8);
    const timingCount = bytes.readUInt32BE(stts.data + 4);
    if (!timingCount || timingCount > 10000)
      throw new IntegrationError('Timing MP4 không hợp lệ.');
    enough(stts, 8 + timingCount * 8);
    let samples = 0,
      timingTicks = 0;
    for (let i = 0; i < timingCount; i++) {
      const count = bytes.readUInt32BE(stts.data + 8 + i * 8),
        delta = bytes.readUInt32BE(stts.data + 12 + i * 8);
      if (
        !count ||
        !delta ||
        (kind === 'vide' && Math.abs(timescale / delta - 30) > 0.001)
      )
        throw new IntegrationError('Video cần tốc độ cố định 30 fps.');
      samples += count;
      timingTicks += count * delta;
    }
    if (Math.abs(timingTicks - ticks) > timescale * 0.1)
      throw new IntegrationError('Thời lượng và timing MP4 không khớp.');
    const stsz = required(sample, 'stsz');
    enough(stsz, 12);
    if (bytes.readUInt32BE(stsz.data + 8) !== samples)
      throw new IntegrationError('Số mẫu MP4 không khớp.');
    const fixedSize = bytes.readUInt32BE(stsz.data + 4);
    if (samples > 1_000_000)
      throw new IntegrationError('MP4 có quá nhiều mẫu.');
    const sizes: number[] = [];
    let dataBytes = fixedSize * samples;
    if (!fixedSize) {
      if (samples > 1_000_000)
        throw new IntegrationError('MP4 có quá nhiều mẫu.');
      enough(stsz, 12 + samples * 4);
      for (let i = 0; i < samples; i++) {
        const size = bytes.readUInt32BE(stsz.data + 12 + i * 4);
        if (!size) throw new IntegrationError('MP4 có mẫu rỗng.');
        sizes.push(size);
        dataBytes += size;
      }
    }
    if (dataBytes <= 0 || dataBytes > mdat.end - mdat.data)
      throw new IntegrationError('Dữ liệu MP4 bị thiếu.');
    const offsets = sample.filter(
      (box) => box.type === 'stco' || box.type === 'co64',
    );
    if (offsets.length !== 1)
      throw new IntegrationError('MP4 thiếu địa chỉ mẫu.');
    const offsetBox = offsets[0];
    enough(offsetBox, 8);
    const offsetCount = bytes.readUInt32BE(offsetBox.data + 4),
      offsetWidth = offsetBox.type === 'stco' ? 4 : 8;
    if (!offsetCount || offsetCount > 10000)
      throw new IntegrationError('MP4 có địa chỉ mẫu không hợp lệ.');
    enough(offsetBox, 8 + offsetCount * offsetWidth);
    const stsc = required(sample, 'stsc');
    enough(stsc, 8);
    const mappingCount = bytes.readUInt32BE(stsc.data + 4);
    if (!mappingCount || mappingCount > offsetCount)
      throw new IntegrationError('Bảng mẫu theo chunk không hợp lệ.');
    enough(stsc, 8 + mappingCount * 12);
    const mappings: { first: number; count: number }[] = [];
    for (let i = 0; i < mappingCount; i++) {
      const position = stsc.data + 8 + i * 12;
      const first = bytes.readUInt32BE(position),
        count = bytes.readUInt32BE(position + 4);
      if (
        first > offsetCount ||
        !count ||
        bytes.readUInt32BE(position + 8) !== 1 ||
        (i === 0 ? first !== 1 : first <= mappings[i - 1].first)
      )
        throw new IntegrationError('Bảng mẫu theo chunk không hợp lệ.');
      mappings.push({ first, count });
    }
    let sampleIndex = 0,
      mappingIndex = 0;
    for (let i = 0; i < offsetCount; i++) {
      if (
        mappingIndex + 1 < mappings.length &&
        mappings[mappingIndex + 1].first === i + 1
      )
        mappingIndex++;
      const count = mappings[mappingIndex].count;
      if (sampleIndex + count > samples)
        throw new IntegrationError('Số mẫu theo chunk không khớp.');
      let chunkBytes = fixedSize * count;
      if (!fixedSize)
        for (let n = 0; n < count; n++) chunkBytes += sizes[sampleIndex + n];
      sampleIndex += count;
      const position = offsetBox.data + 8 + i * offsetWidth;
      const offset =
        offsetWidth === 4
          ? bytes.readUInt32BE(position)
          : Number(bytes.readBigUInt64BE(position));
      if (
        !Number.isSafeInteger(offset) ||
        offset < mdat.data ||
        offset >= mdat.end ||
        offset + chunkBytes > mdat.end
      )
        throw new IntegrationError('Mẫu MP4 nằm ngoài dữ liệu.');
      chunkRanges.push({ start: offset, end: offset + chunkBytes });
    }
    if (sampleIndex !== samples)
      throw new IntegrationError('Số mẫu theo chunk không khớp.');
    const tkhdVersion = bytes[tkhd.data];
    if (tkhdVersion !== 0 && tkhdVersion !== 1)
      throw new IntegrationError('Track header không hỗ trợ.');
    enough(tkhd, tkhdVersion === 1 ? 96 : 84);
    const width = bytes.readUInt32BE(tkhd.end - 8) / 65536,
      height = bytes.readUInt32BE(tkhd.end - 4) / 65536;
    if (
      kind === 'vide' &&
      (width !== 1080 ||
        height !== 1920 ||
        bytes.readUInt16BE(entry.data + 24) !== width ||
        bytes.readUInt16BE(entry.data + 26) !== height)
    )
      throw new IntegrationError('Video cần kích thước dọc 1080×1920.');
    return { kind, duration: ticks / timescale, width, height };
  });
  chunkRanges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < chunkRanges.length; i++)
    if (chunkRanges[i].start < chunkRanges[i - 1].end)
      throw new IntegrationError('Các chunk MP4 chồng lấn dữ liệu.');
  const video = parsed.filter((track) => track.kind === 'vide'),
    audio = parsed.filter((track) => track.kind === 'soun');
  if (video.length !== 1 || audio.length !== 1)
    throw new IntegrationError('Video thiếu hình hoặc âm thanh.');
  if (Math.abs(video[0].duration - audio[0].duration) > 0.5)
    throw new IntegrationError('Hình và âm thanh lệch thời lượng.');
  if (video[0].duration < 60 || video[0].duration > 90)
    throw new IntegrationError('Video cần dài 60–90 giây.');
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    duration: video[0].duration,
    bytes: bytes.length,
    videoCodec: 'h264',
    audioCodec: 'aac',
  };
}
