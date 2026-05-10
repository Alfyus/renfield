import { useTranslation } from 'react-i18next';
import { Menu } from 'lucide-react';
import ChatSidebar from '../../components/ChatSidebar';
import { WissensbasisSidePanel } from '../../components/wissensbasis/WissensbasisSidePanel';
import { WissensbasisProvider } from '../../context/WissensbasisContext';

import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import { ChatProvider, useChatContext } from './context/ChatContext';

function ChatPageLayout() {
  const { t } = useTranslation();
  const {
    sidebarOpen, setSidebarOpen,
    conversations, conversationsLoading,
    sessionId, switchConversation, startNewChat, handleDeleteConversation,
  } = useChatContext();

  return (
    <div className="h-[calc(100vh-8rem)] flex">
      {/* Mobile Sidebar Toggle Button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed bottom-36 left-4 z-10 md:hidden p-3 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg transition-colors"
        aria-label={t('chat.openConversations')}
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeSessionId={sessionId}
        onSelectConversation={switchConversation}
        onNewChat={startNewChat}
        onDeleteConversation={handleDeleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        loading={conversationsLoading}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader />
        <ChatMessages />
        <ChatInput />
      </div>

      {/* Wissensbasis side panel — A-LANDING composed view (A2 reasoning + A4 focus).
          Self-gates: backend routes return 404 when REVA_WISSENSBASIS_ENABLED=false,
          which makes every query enabled=false and the panel renders empty placeholders.
          Citation chips inside ChatMessages reach the same WissensbasisProvider via
          context, so chip click → setFocus → side panel refocus works end-to-end. */}
      <WissensbasisSidePanel sessionId={sessionId} role={null} />
    </div>
  );
}

export default function ChatPage() {
  return (
    // Provider wraps BOTH the chat area (whose AdaptiveCardRenderer emits
    // CitationChip components consuming useWissensbasis) and the side panel
    // (which reads the same focus state). syncWithUrl=false on this surface
    // because chat-page URLs already encode the conversation; we don't want
    // every chip click pushing a `?focus=` param into the chat URL bar.
    // The standalone /wissensbasis page sets syncWithUrl=true.
    <ChatProvider>
      <WissensbasisProvider syncWithUrl={false} defaultCollapsed>
        <ChatPageLayout />
      </WissensbasisProvider>
    </ChatProvider>
  );
}
