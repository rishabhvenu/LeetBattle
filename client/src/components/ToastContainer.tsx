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
      autoClose={900}
      hideProgressBar={false}
      newestOnTop={false}
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme="dark"
      toastClassName={() =>
        "relative flex p-1 min-h-10 rounded-md justify-between overflow-hidden cursor-pointer bg-slate-800 border border-slate-700 mb-4"
      }
      bodyClassName={() =>
        "text-sm font-medium text-slate-200 flex items-center p-3"
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
