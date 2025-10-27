"use client";

import React, { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Camera,
  User,
  Mail,
  Key,
  Eye,
  EyeOff,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { ToastContainer } from "@/components/ToastContainer";
import { generatePresignedUploadUrl, saveUserAvatar, changePassword } from "@/lib/actions";
import { useRouter } from "next/navigation";
// Image import removed - using regular img tags instead
import { getAvatarUrl } from "@/lib/utils";

export default function SettingsPage({ session, restHandler }) {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [isAvatarChanged, setIsAvatarChanged] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passwordVisibility, setPasswordVisibility] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [formData, setFormData] = useState({
    username: session?.username || "User",
    email: session?.email || "user@example.com",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const togglePasswordVisibility = (field: 'currentPassword' | 'newPassword' | 'confirmPassword') => {
    setPasswordVisibility(prev => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isAvatarChanged && selectedAvatarFile) {
      try {
        const file = selectedAvatarFile;
        const fileType = file.type;
        const fileExtension = file.name.split(".").pop()?.toLowerCase() || "png";
        const fileName = `${session._id}.${fileExtension}`;
        const result = await generatePresignedUploadUrl(fileName, fileType);
        if (!result.success) throw new Error(result.error);
        const renamedFile = new File([file], fileName, { type: fileType });
        const response = await fetch(result.presignedUrl, {
          method: "PUT",
          body: renamedFile,
          headers: { "Content-Type": fileType },
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error("Upload failed with status:", response.status, "Response:", errorText);
          throw new Error(`Failed to upload image: ${response.status} ${response.statusText}`);
        }
        setAvatar(fileName);
        // Persist avatar to session and user so it loads after reload
        const persisted = await saveUserAvatar(fileName);
        if (!persisted.success) {
          console.warn('Avatar uploaded but not persisted to session:', persisted.error);
        }
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
        setSelectedAvatarFile(null);
        setIsAvatarChanged(false);
        toast.success("Profile picture updated successfully!");
        // Refresh the page to load the new avatar from session
        router.refresh();
      } catch (error) {
        console.error("Error uploading image:", error);
        toast.error("Failed to upload image. Please try again.");
        return;
      }
    }

    if (formData.newPassword.trim() !== "") {
      if (formData.newPassword !== formData.confirmPassword) {
        toast.error("New password and confirm password do not match");
        return;
      }
      
      try {
        const result = await changePassword(formData.currentPassword, formData.newPassword);
        if (result.success) {
          toast.success("Password updated successfully!");
          // Clear password fields after successful change
          setFormData(prev => ({
            ...prev,
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
          }));
        } else {
          toast.error(result.error || "Failed to update password");
        }
      } catch (error) {
        console.error("Password change error:", error);
        toast.error("An error occurred while changing password");
      }
    } else if (!isAvatarChanged) {
      toast.info("No changes to save.");
    }
  };

  useEffect(() => {
    setFormData({
      username: session?.username || "User",
      email: session?.email || "user@example.com",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setAvatar(session?.avatar);
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [session]);

  const handleAvatarChange = (e: React.MouseEvent) => {
    e.preventDefault();
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileExtension = file.name.split(".").pop()?.toLowerCase();
    if (!fileExtension) {
      toast.error("Invalid file type. Please select a valid image file.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl(previewUrl);
    setSelectedAvatarFile(file);
    setIsAvatarChanged(true);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };

  return (
    <div className="min-h-screen bg-blue-50 text-black relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
      </div>
      <ScrollArea className="h-screen relative z-10">
        <motion.div
          className="max-w-4xl mx-auto p-8"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-4xl font-bold mb-8 text-white"
            variants={itemVariants}
          >
            Settings
          </motion.h1>

          <form onSubmit={handleSubmit} className="space-y-8">
            <motion.div
              className="bg-white/90 backdrop-blur-sm border border-blue-200 rounded-lg p-6"
              variants={itemVariants}
            >
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <User className="h-6 w-6" style={{ color: '#2599D4' }} />
                Profile Information
              </h2>
              <div className="flex items-center gap-6 mb-6">
                <div className="relative">
                  <Avatar className="w-24 h-24 border-4 border-blue-200">
                    <AvatarImage
                      src={avatarPreviewUrl || getAvatarUrl(avatar)}
                      alt="Profile picture"
                    />
                    <AvatarFallback>
                      <img 
                        src="/placeholder_avatar.png"
                        alt="Profile placeholder"
                        width={96}
                        height={96}
                        className="w-full h-full object-cover"
                      />
                    </AvatarFallback>
                  </Avatar>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute bottom-0 right-0 rounded-full text-white shadow-lg"
                    onClick={(e) => handleAvatarChange(e)}
                    style={{ backgroundColor: '#2599D4' }}
                  >
                    <Camera className="h-4 w-4" />
                    <span className="sr-only">Change Avatar</span>
                  </Button>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">
                    Profile Picture
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white text-black border-blue-200 hover:bg-slate-600 hover:text-white transition-colors"
                    onClick={(e) => handleAvatarChange(e)}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    Change Avatar
                  </Button>
                </div>
              </div>
              <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="username"
                    className="text-sm font-medium text-black"
                  >
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/70" />
                    <Input
                      id="username"
                      name="username"
                      value={formData.username}
                      disabled={true}
                      className="bg-white border-blue-200 text-black placeholder:text-black/70 pl-10 cursor-not-allowed opacity-60"
                    />
                  </div>
                  <p className="text-sm text-black/70">
                    This is your public display name.
                  </p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-black"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/70" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      disabled={true}
                      className="bg-white border-blue-200 text-black placeholder:text-black/70 pl-10 cursor-not-allowed opacity-60"
                    />
                  </div>
                  <p className="text-sm text-black/70">
                    Your email address for notifications.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="bg-white/90 backdrop-blur-sm border border-blue-200 rounded-lg p-6"
              variants={itemVariants}
            >
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <Key className="h-6 w-6" style={{ color: '#2599D4' }} />
                Change Password
              </h2>
              <div className="space-y-4">
                {["currentPassword", "newPassword", "confirmPassword"].map(
                  (field) => (
                    <div key={field} className="space-y-2">
                      <label
                        htmlFor={field}
                        className="text-sm font-medium text-black"
                      >
                        {field === "currentPassword"
                          ? "Current Password"
                          : field === "newPassword"
                          ? "New Password"
                          : "Confirm New Password"}
                      </label>
                      <div className="relative">
                        <Input
                          id={field}
                          name={field}
                          type={passwordVisibility[field as keyof typeof passwordVisibility] ? "text" : "password"}
                          value={formData[field as keyof typeof formData]}
                          onChange={handleInputChange}
                          className="bg-white border-blue-200 text-black pr-10"
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                          onClick={() => togglePasswordVisibility(field as 'currentPassword' | 'newPassword' | 'confirmPassword')}
                        >
                          {passwordVisibility[field as keyof typeof passwordVisibility] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </motion.div>

            <motion.div
              className="flex justify-end gap-4"
              variants={itemVariants}
            >
              <Button
                type="button"
                variant="outline"
                className="bg-white text-black border-blue-200 hover:bg-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="text-white"
                style={{ backgroundColor: '#2599D4' }}
              >
                Save Changes
              </Button>
            </motion.div>
          </form>
        </motion.div>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".jpg,.jpeg,.png,.svg,.webp"
          onChange={handleFileUpload}
        />
      </ScrollArea>
    </div>
  );
}
