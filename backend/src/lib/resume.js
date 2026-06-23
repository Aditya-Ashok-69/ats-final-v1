import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

// Extract plain text from an uploaded resume buffer. Local only, no network.
export async function parseResume(buffer, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();

  try {
    if (ext === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return (text || '').trim();
    }
    if (ext === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer });
      return (value || '').trim();
    }
    if (ext === 'txt') {
      return buffer.toString('utf8').trim();
    }
  } catch (e) {
    console.error('Resume parse failed:', e.message);
    return '';
  }
  return ''; // unsupported type
}
