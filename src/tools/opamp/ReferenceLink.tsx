import { useState, type ReactNode } from 'react';
import { errorMessage, native } from '../../services/api';
import { openReference } from './api';
export function ReferenceLink({ href, children }: { href: string; children: ReactNode }) {
  const [error, setError] = useState('');
  return <><a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (native) { event.preventDefault(); setError(''); void openReference(href).catch(error => setError(errorMessage(error))); }
  }}>{children}</a>{error && <span className="opamp-link-error" role="alert">打开参考资料失败：{error}</span>}</>;
}
