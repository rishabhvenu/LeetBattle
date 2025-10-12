"use client";

import { StrictMode, useState, useEffect, createContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import PlaceholderSocketService from "@/services/PlaceholderSocketService";
import PlaceholderRestService from "@/services/PlaceholderRestService";
import { ToastContainer } from "@/components/ToastContainer";
import { toast } from "react-toastify";
import "./globals.css";

const restService = new PlaceholderRestService();
const socketService = new PlaceholderSocketService(restService);

export const SocketContext = createContext<PlaceholderSocketService | null>(null);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      await socketService.connect();

      // Removed friend system and messaging handlers - not implemented yet
    })();
    return () => {
      socketService.disconnect();
    };
  }, []);

  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css"
        />
      </head>
      <body>
        <SocketContext.Provider value={socketService}>
          <ToastContainer />
          {children}
        </SocketContext.Provider>
      </body>
    </html>
  );
}