import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { parseDateSafe } from '../../utils/time';
import { Send, X, CheckCircle2 } from 'lucide-react';
import { useBottomSheetGesture } from '../../hooks/useBottomSheetGesture';

interface MessageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MessageManagerModal: React.FC<MessageManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { dragOffset, handleProps } = useBottomSheetGesture({ isOpen, onClose });
  const { currentStaffId, sendMessageToManager, messages, notifications } = useApp();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setIsSending(true);
    await sendMessageToManager(currentStaffId, text);
    setIsSending(false);
    setSentSuccess(true);

    setTimeout(() => {
      setSentSuccess(false);
      setText('');
      onClose();
    }, 1200);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-hidden"
    >
      <div
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset === 0 ? 'transform 0.2s ease-out' : 'none',
        }}
        className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-[#111111]"
      >
        
        {/* Mobile Drag Handle */}
        <div
          {...handleProps}
          className="sm:hidden pt-3 pb-3 px-8 flex justify-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
          title="Потяните вниз, чтобы закрыть"
        >
          <div className="w-12 h-1 bg-[#d9dbe0] rounded pointer-events-none" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[#111111]">Написать руководителю</h3>
            <p className="text-xs text-[#5d6270]">Сообщение начальнику склада / руководству</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chat History & Message Input */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[60vh] overscroll-contain">
          {(() => {
            const mySentMsgs = messages.filter(m => m.fromEmployeeId === currentStaffId);
            const myReplies = notifications.filter(
              n => (n.toEmployeeId === currentStaffId || n.toEmployeeId === 'all') && n.title.includes('Ответ')
            );

            const threadItems = [
              ...mySentMsgs.map(m => ({ id: m.id, type: 'sent' as const, text: m.message, timestamp: m.timestamp, title: 'Вы' })),
              ...myReplies.map(r => ({ id: r.id, type: 'received' as const, text: r.text, timestamp: r.timestamp, title: r.title || 'Руководитель' })),
            ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            if (threadItems.length === 0) {
              return (
                <div className="text-center py-6 text-xs text-[#5d6270] bg-[#f7f9ff] rounded-md p-4 border border-[#d9dbe0]">
                  История переписки пока пуста. Напишите ваше сообщение руководителю ниже.
                </div>
              );
            }

            return (
              <div className="space-y-2.5">
                <div className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] text-center mb-1">
                  История обращений и ответов ({threadItems.length})
                </div>
                {threadItems.map(item => (
                  <div
                    key={item.id}
                    className={`p-3 rounded text-xs space-y-1 border ${
                      item.type === 'sent'
                        ? 'bg-[#eef2ff] border-[#a9bcff] text-[#111111] ml-6'
                        : 'bg-amber-50 border-amber-300 text-[#111111] mr-6'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold ${item.type === 'sent' ? 'text-[#2f63ff]' : 'text-[#b45309]'}`}>
                        {item.title}
                      </span>
                      <span className="text-[11px] text-[#5d6270] font-mono tabular-nums">
                        {parseDateSafe(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="leading-relaxed text-[#111111] whitespace-pre-wrap">{item.text}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Message Input Form */}
        <form onSubmit={handleSubmit} className="p-3.5 border-t border-[#e5e7eb] bg-[#f7f9ff] shrink-0 space-y-2.5">
          {sentSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold rounded-md text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Сообщение успешно отправлено руководителю!</span>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <textarea
              rows={2}
              required
              placeholder="Введите сообщение или ответ руководителю..."
              value={text}
              onChange={e => setText(e.target.value)}
              className="flex-1 px-3 py-2 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 transition-colors resize-none placeholder:text-[#5d6270]/70"
            />
            <button
              type="submit"
              disabled={isSending || !text.trim()}
              className={`px-4 py-2.5 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors shrink-0 h-10 ${
                text.trim() && !isSending
                  ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer'
                  : 'bg-[#eef2ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? '...' : 'Отправить'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
