import { ReactNode } from "react";

interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  return (
    <div className="flex flex-col min-h-screen w-full">
      {/* Header on top */}
      <header className="w-full">
        {/* your header */}
      </header>
      {/* Main content BELOW header, not beside */}
      <main className="flex flex-col flex-1 w-full gap-4 p-4">
        {children}
      </main>
    </div>
  );
}
