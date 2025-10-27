import React, { useEffect, useState } from "react";
import {
  ToastContainer as ReactToastContainer,
  ToastContainerProps,
  toast,
} from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export function ToastContainer(props: ToastContainerProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // Check if dark mode is enabled
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains('dark') || 
                    window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };

    checkDarkMode();

    // Listen for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  return (
    <ReactToastContainer
      position="top-right"
      autoClose={3000}
      hideProgressBar={false}
      newestOnTop={false}
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme={isDarkMode ? "dark" : "light"}
      toastClassName={() =>
        isDarkMode 
          ? "relative flex p-1 min-h-10 rounded-md justify-between overflow-hidden cursor-pointer bg-gray-900/95 border border-gray-700 mb-4 shadow-lg backdrop-blur-sm"
          : "relative flex p-1 min-h-10 rounded-md justify-between overflow-hidden cursor-pointer bg-white/95 border border-blue-200 mb-4 shadow-lg backdrop-blur-sm"
      }
      bodyClassName={() =>
        isDarkMode
          ? "text-sm font-medium text-white flex items-center p-3"
          : "text-sm font-medium text-black flex items-center p-3"
      }
      {...props}
    />
  );
}

// Custom toast functions
export const showToast = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast.info(message),
  warning: (message: string) => toast.warning(message),
};
