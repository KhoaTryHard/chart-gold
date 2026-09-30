'use client';

import { useState } from 'react';
import { Download, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { defaultLocale, type Locale } from '@/lib/i18n';
import {
  clearPortfolioLedger,
  exportPortfolioLedger,
  importPortfolioLedger,
  ledgerIntegrityIssueMessage,
  previewLedgerRestore,
  readPortfolioLedger,
  savePortfolioLedger,
  type LedgerRestorePreview,
  type PortfolioLedger,
} from '@/lib/portfolio-ledger';

const EMPTY_LEDGER: PortfolioLedger = { version: 1, transactions: [] };

type PendingRestore = {
  incoming: PortfolioLedger;
  preview: LedgerRestorePreview;
};

export function LedgerBackup({
  account,
  ledger,
  disabled = false,
  locale = defaultLocale,
  onChange,
}: {
  account: string;
  ledger: PortfolioLedger;
  disabled?: boolean;
  locale?: Locale;
  onChange: (ledger: PortfolioLedger) => void | Promise<boolean>;
}) {
  const english = locale === 'en';
  const [notice, setNotice] = useState('');
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const exportBackup = () => {
    try {
      const blob = new Blob([exportPortfolioLedger(ledger)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'kim-tuyen-so-vang-backup.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(english ? 'Ledger backup downloaded.' : 'Đã tải bản sao sổ.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (english ? 'Could not export the ledger.' : 'Không thể xuất bản sao sổ.'));
    }
  };

  const inspectRestore = async (file: File | undefined) => {
    if (!file) return;
    setNotice('');
    try {
      const incoming = importPortfolioLedger(await file.text());
      const preview = previewLedgerRestore(ledger, incoming);
      setPendingRestore({ incoming, preview });
    } catch (error) {
      setPendingRestore(null);
      setNotice(error instanceof Error ? error.message : (english ? 'The backup file is invalid.' : 'File sao lưu không hợp lệ.'));
    }
  };

  const applyRestore = async () => {
    if (!pendingRestore || pendingRestore.preview.error || !pendingRestore.preview.candidate) return;
    try {
      const current = readPortfolioLedger(account) ?? ledger;
      const latest = previewLedgerRestore(current, pendingRestore.incoming);
      if (latest.error || !latest.candidate) {
        setPendingRestore({ incoming: pendingRestore.incoming, preview: latest });
        return;
      }
      savePortfolioLedger(account, latest.candidate);
      const saved = await onChange(latest.candidate);
      if (saved === false) return;
      setPendingRestore(null);
      setNotice(english ? `${latest.additions.length} transaction(s) restored.` : `Đã khôi phục ${latest.additions.length} giao dịch.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (english ? 'Could not restore the ledger.' : 'Không thể khôi phục sổ.'));
    }
  };

  const clearLedger = async () => {
    try {
      clearPortfolioLedger(account);
      const saved = await onChange(EMPTY_LEDGER);
      if (saved === false) return;
      setConfirmClear(false);
      setNotice(english ? 'Ledger cleared.' : 'Đã xóa toàn bộ sổ.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (english ? 'Could not clear the ledger.' : 'Không thể xóa sổ.'));
    }
  };

  const preview = pendingRestore?.preview;
  return (
    <>
      <section className="glass-panel p-5 sm:p-7" aria-labelledby="ledger-backup-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <div><h2 id="ledger-backup-title" className="font-heading text-xl font-semibold">{english ? 'Backup and restore' : 'Sao lưu và khôi phục'}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{english ? 'Download a private copy of your account transactions for migration or recovery. Restoring adds transactions without replacing your current server ledger.' : 'Tải bản sao riêng tư của sổ theo tài khoản để chuyển hoặc khôi phục. Khôi phục sẽ thêm giao dịch và không thay thế sổ hiện tại trên máy chủ.'}</p></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={disabled || !ledger.transactions.length} onClick={exportBackup}><Download className="mr-1.5 size-4" />{english ? 'Download ledger backup' : 'Tải bản sao sổ'}</Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border bg-card/70 px-4 text-sm font-semibold hover:bg-card has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"><Upload className="mr-1.5 size-4" />{english ? 'Restore a backup copy' : 'Khôi phục bản sao lưu'}<input type="file" accept="application/json,.json" className="sr-only" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void inspectRestore(file); }} /></label>
          <Button type="button" variant="ghost" disabled={disabled || !ledger.transactions.length} onClick={() => setConfirmClear(true)}><Trash2 className="mr-1.5 size-4" />{english ? 'Clear ledger' : 'Xóa toàn bộ sổ'}</Button>
        </div>
        {notice ? <output className="mt-4 block text-sm text-primary">{notice}</output> : null}
        {preview ? <div className="mt-5 rounded-[16px] border border-border bg-card/55 p-4" aria-live="polite"><div className="flex items-center gap-2 font-semibold"><RotateCcw className="size-4 text-primary" />{english ? 'Restore preview' : 'Xem trước khôi phục'}</div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p>{english ? 'Current' : 'Đang có'}: <strong>{preview.currentCount}</strong></p><p>{english ? 'Add' : 'Sẽ thêm'}: <strong>{preview.additions.length}</strong></p><p>{english ? 'Already present' : 'Đã có'}: <strong>{preview.duplicates.length}</strong></p></div>{preview.conflicts.length ? <div className="mt-3 rounded-xl border border-red-300/60 bg-red-50/70 p-3 text-sm text-red-900 dark:border-red-700/60 dark:bg-red-950/20 dark:text-red-100"><p className="font-semibold">{english ? 'Restore blocked: conflicting transaction IDs.' : 'Không thể khôi phục: mã giao dịch bị xung đột.'}</p>{preview.conflicts.slice(0, 5).map((conflict) => <p key={conflict.id} className="mt-1">{conflict.id}</p>)}</div> : null}{preview.error && !preview.conflicts.length ? <p className="mt-3 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-100">{preview.error.issues[0] ? ledgerIntegrityIssueMessage(preview.error.issues[0], locale) : preview.error.message}</p> : null}{!preview.error && !preview.conflicts.length ? <div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={applyRestore}>{english ? 'Apply restore' : 'Áp dụng khôi phục'}</Button><Button type="button" variant="outline" onClick={() => setPendingRestore(null)}>{english ? 'Cancel' : 'Hủy'}</Button></div> : <Button type="button" className="mt-4" variant="outline" onClick={() => setPendingRestore(null)}>{english ? 'Close' : 'Đóng'}</Button>}</div> : null}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{english ? `The current account ledger has ${ledger.transactions.length} transaction(s). The local copy is only a cache.` : `Sổ của tài khoản hiện có ${ledger.transactions.length} giao dịch. Bản cục bộ chỉ là cache.`}</p>
      </section>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{english ? 'Clear this ledger?' : 'Xóa sổ vàng?'}</AlertDialogTitle><AlertDialogDescription>{english ? `This removes ${ledger.transactions.length} transaction(s) from your account. Download a backup first if you may need them later.` : `Thao tác này xóa ${ledger.transactions.length} giao dịch khỏi tài khoản. Hãy tải bản sao trước nếu bạn có thể cần dùng lại.`}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><Button type="button" variant="outline" onClick={exportBackup}>{english ? 'Download backup first' : 'Tải bản sao trước'}</Button><AlertDialogCancel>{english ? 'Cancel' : 'Hủy'}</AlertDialogCancel><AlertDialogAction onClick={clearLedger}>{english ? 'Clear ledger' : 'Xóa sổ'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
