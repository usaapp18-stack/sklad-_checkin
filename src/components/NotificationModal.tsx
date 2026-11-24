import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { parseDateSafe } from '../utils/time';
import { Bell, X, CheckCheck, Heart, FileText, Clock, CornerDownLeft, Send, Check, User } from 'lucide-react';
import { useBottomSheetGesture } from '../hooks/useBottomSheetGesture';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { dragOffset, handleProps } = useBottomSheetGesture({ isOpen, onClose });
  const {
    currentRole,
    currentStaffId,
    currentStaff,
    notifications,
    messages,
    markNotificationRead,
    markMessageRead,
    markAllNotificationsRead,
    markAllMessagesRead,
    replyToMessage,
  } = useApp();

  const [replyingMsgId, setReplyingMsgId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [isSendingReply, setIsSendingReply] = useState<boolean>(false);
  const [replySuccessMsgId, setReplySuccessMsgId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendReply = async (msgId: string) => {
    if (!replyText.trim()) return;
    setIsSendingReply(true);
    const res = await replyToMessage(msgId, replyText.trim());
    setIsSendingReply(false);
    if (res.success) {
      setReplySuccessMsgId(msgId);
      setReplyText('');
      setTimeout(() => {
        setReplySuccessMsgId(null);
        setReplyingMsgId(null);
      }, 2000);
    }
  };

  const staffLocs = currentStaff?.locations || (currentStaff?.location ? [currentStaff.location] : []);

  const relevantNotifs = notifications.filter(n => {
    if (currentRole === 'manager') {
      return n.type === 'report' || n.type === 'system' || n.toEmployeeId === 'manager';
    } else {
      const isTargeted = n.toEmployeeId === currentStaffId || n.toEmployeeId === 'all';
      if (!isTargeted) return false;
      if (n.location) {
        return staffLocs.includes(n.location);
      }
      return true;
    }
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'thank_you':
        return <Heart className="w-4 h-4 text-rose-600" />;
      case 'reminder':
        return <Clock className="w-4 h-4 text-[#b45309]" />;
      case 'report':
        return <FileText className="w-4 h-4 text-[#2f63ff]" />;
      default:
        return <Bell className="w-4 h-4 text-[#5d6270]" />;
    }
  };

  const handleMarkAllRead = () => {
    markAllNotificationsRead();
    if (currentRole === 'manager') {
      markAllMessagesRead();
    }
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
        className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-[#111111]"
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
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[#111111]">Уведомления и сообщения</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAllRead}
              className="text-xs font-medium text-[#2d313b] hover:text-[#111111] flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] transition-colors cursor-pointer"
              title="Отметить всё как прочитанное"
            >
              <CheckCheck className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Прочитать всё</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
          
          {/* Manager Incoming Staff Messages */}
          {currentRole === 'manager' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
                Сообщения от сотрудников
              </div>
              {messages.length === 0 ? (
                <div className="text-xs text-[#5d6270] py-2">Нет сообщений от сотрудников</div>
              ) : (
                <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                  {messages.map(msg => {
                    const isReplying = replyingMsgId === msg.id;
                    const isSuccess = replySuccessMsgId === msg.id;

                    const employeeId = msg.fromEmployeeId;
                    const employeeMessages = messages.filter(m => m.fromEmployeeId === employeeId);
                    const managerReplies = notifications.filter(n => n.toEmployeeId === employeeId && ((n as any).source === 'manager' || n.title.includes('Ответ')));

                    const threadItems = [
                      ...employeeMessages.map(m => ({
                        id: m.id,
                        type: 'employee' as const,
                        text: m.message,
                        timestamp: m.timestamp,
                        senderName: m.fromEmployeeName,
                      })),
                      ...managerReplies.map(n => ({
                        id: n.id,
                        type: 'manager' as const,
                        text: n.text,
                        timestamp: n.timestamp,
                        senderName: 'Руководитель',
                      })),
                    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                    return (
                      <div
                        key={msg.id}
                        onClick={() => { if (!msg.read) markMessageRead(msg.id); }}
                        className={`p-3.5 transition-colors ${
                          !msg.read
                            ? 'bg-[#eef2ff]/60 text-[#111111]'
                            : 'bg-white text-[#2d313b]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                            <User className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
                            <span>Сотрудник: <strong className="text-[#111111] font-bold">{msg.fromEmployeeName}</strong></span>
                            {!msg.read && (
                              <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff]" />
                            )}
                          </div>
                          <span className="text-[11px] text-[#5d6270] font-mono tabular-nums">
                            {parseDateSafe(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* Full Thread Conversation History */}
                        <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-1">
                          {threadItems.map(item => (
                            <div
                              key={item.id}
                              className={`p-2.5 rounded text-xs border ${
                                item.type === 'employee'
                                  ? 'bg-[#f7f9ff] border-[#e5e7eb] text-[#111111] mr-4'
                                  : 'bg-[#eef2ff] border-[#a9bcff] text-[#111111] ml-4'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#5d6270] mb-1">
                                <span className="font-semibold text-[#2d313b]">
                                  {item.senderName}
                                </span>
                                <span className="font-mono tabular-nums">
                                  {parseDateSafe(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="leading-relaxed whitespace-pre-wrap text-[#111111]">{item.text}</p>
                            </div>
                          ))}
                        </div>

                        {/* Reply Action & Inline Form */}
                        {isSuccess ? (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold py-1.5 px-2.5 bg-emerald-50 rounded border border-emerald-200">
                            <Check className="w-3.5 h-3.5" />
                            <span>Ответ успешно отправлен сотруднику!</span>
                          </div>
                        ) : isReplying ? (
                          <div className="mt-2 space-y-2 pt-2 border-t border-[#e5e7eb]" onClick={e => e.stopPropagation()}>
                            <textarea
                              rows={2}
                              autoFocus
                              aria-label={`Ответ сотруднику ${msg.fromEmployeeName}`}
                              placeholder={`Ответ сотруднику ${msg.fromEmployeeName}...`}
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              className="w-full p-2 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 resize-none"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => { setReplyingMsgId(null); setReplyText(''); }}
                                className="px-2.5 py-1 text-xs font-medium text-[#2d313b] hover:text-[#111111] bg-white border border-[#d9dbe0] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                disabled={isSendingReply || !replyText.trim()}
                                onClick={() => handleSendReply(msg.id)}
                                className="px-3 py-1 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#f7f9ff] disabled:text-[#5d6270] text-white text-xs font-semibold rounded flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <Send className="w-3 h-3" />
                                <span>{isSendingReply ? 'Отправка...' : 'Отправить'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end pt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReplyingMsgId(msg.id);
                                setReplyText('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
                            >
                              <CornerDownLeft className="w-3 h-3 text-[#2f63ff]" />
                              <span>Ответить</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* System Notifications & Bot Broadcasts */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
              Оповещения бота и рассылки
            </div>
            {relevantNotifs.length === 0 ? (
              <div className="text-xs text-[#5d6270] py-2">Уведомлений нет</div>
            ) : (
              <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                {relevantNotifs.map(n => (
                  <div
                    key={n.id}
                    onClick={() => markNotificationRead(n.id)}
                    className={`p-3.5 transition-colors cursor-pointer ${
                      !n.read
                        ? 'bg-[#eef2ff]/55 text-[#111111]'
                        : 'bg-white text-[#2d313b] hover:bg-[#f7f9ff]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111111] min-w-0">
                        {getIcon(n.type)}
                        <span className="truncate">{n.title}</span>
                        {n.location && (
                          <span className="text-[11px] text-[#2f63ff] font-medium shrink-0">
                            · {n.location}
                          </span>
                        )}
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff] shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] text-[#5d6270] font-mono tabular-nums shrink-0">
                        {parseDateSafe(n.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-[#2d313b] leading-relaxed">{n.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
