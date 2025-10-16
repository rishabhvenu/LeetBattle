import React from "react";
import {
  ToastContainer as ReactToastContainer,
  ToastContainerProps,
  toast,
} from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export function ToastContainer(props: ToastContainerProps) {
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
      theme="light"
      toastClassName={() =>
        "relative flex p-1 min-h-10 rounded-md justify-between overflow-hidden cursor-pointer bg-white/95 border border-blue-200 mb-4 shadow-lg backdrop-blur-sm"
      }
      bodyClassName={() =>
        "text-sm font-medium text-black flex items-center p-3"
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
