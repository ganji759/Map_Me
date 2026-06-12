'use client'

const DOT_TONES = ['#FFA94D', '#FF8C2F', '#F56A00']

/** Assistant-style bubble with three bouncing brand-orange dots. */
export function TypingIndicator() {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-gray-200/80 bg-white px-4 py-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.05)] dark:border-white/[0.08] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.45)]"
      aria-label="Hodari is thinking"
    >
      {DOT_TONES.map((tone, i) => (
        <span
          key={tone}
          className="typing-dot h-2 w-2 rounded-full"
          style={{
            backgroundColor: tone,
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
      <style>{`
        .typing-dot {
          opacity: 0.5;
          animation: typing-bounce 1.2s ease-in-out infinite;
        }
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .typing-dot { animation: none; opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
