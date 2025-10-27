'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'react-toastify';
import { getUsers, getTotalUsersCount, getUserById, updateUser, User } from '@/lib/actions';
import { ChevronLeft, ChevronRight, Search, Edit, Loader2, Users } from 'lucide-react';
import { getAvatarUrl } from '@/lib/utils';
// Image import removed - using regular img tags instead

type SearchType = 'username' | 'id';

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('username');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const entriesPerPage = 10;

  // Handle mounting to prevent hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load users when component mounts or search/page changes
  useEffect(() => {
    if (mounted) {
      fetchUsers();
    }
  }, [mounted, currentPage, searchTerm, searchType]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      
      // Fetch users and count in parallel
      const [usersResult, countResult] = await Promise.all([
        getUsers(currentPage, entriesPerPage, searchTerm || undefined, searchType),
        getTotalUsersCount(searchTerm || undefined, searchType)
      ]);

      if (usersResult.success && countResult.success) {
        setUsers((usersResult.users || []) as User[]);
        setTotalCount(countResult.count || 0);
        setTotalPages(Math.ceil((countResult.count || 0) / entriesPerPage));
      } else {
        toast.error(usersResult.error || countResult.error || 'Failed to fetch users');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1); // Reset to first page when searching
    fetchUsers();
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleEditUser = async (userId: string) => {
    try {
      const result = await getUserById(userId);
      if (result.success && result.user) {
        setEditingUser(result.user as User);
        setEditDialogOpen(true);
      } else {
        toast.error(result.error || 'Failed to load user data');
      }
    } catch (error) {
      console.error('Error loading user:', error);
      toast.error('Failed to load user data');
    }
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSaving(true);
    try {
      const result = await updateUser(editingUser._id!, {
        username: editingUser.username,
        email: editingUser.email,
        profile: editingUser.profile,
        stats: editingUser.stats,
      });

      if (result.success) {
        toast.success('User updated successfully');
        setEditDialogOpen(false);
        setEditingUser(null);
        fetchUsers(); // Refresh the list
      } else {
        toast.error(result.error || 'Failed to update user');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error('Failed to update user');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEditingUser = (field: string, value: string | number) => {
    if (!editingUser) return;

    if (field.startsWith('profile.')) {
      const profileField = field.split('.')[1];
      setEditingUser({
        ...editingUser,
        profile: {
          ...editingUser.profile,
          [profileField]: value,
        },
      });
    } else if (field.startsWith('stats.')) {
      const statsField = field.split('.')[1];
      setEditingUser({
        ...editingUser,
        stats: {
          ...editingUser.stats,
          [statsField]: value,
        },
      });
    } else {
      setEditingUser({
        ...editingUser,
        [field]: value,
      });
    }
  };

  // Prevent hydration issues by not rendering until mounted
  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-white/60 rounded w-1/4 mb-6"></div>
          <div className="h-4 bg-white/60 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-white/60 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-black mb-2 flex items-center gap-2">
          <Users className="h-6 w-6" style={{ color: '#2599D4' }} />
          User Management
        </h2>
        <p className="text-black/70">Search, view, and edit user accounts</p>
      </div>

      <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
        <CardHeader>
          <CardTitle className="text-black flex items-center gap-2">
            <Users className="h-5 w-5" style={{ color: '#2599D4' }} />
            Users ({totalCount})
          </CardTitle>
          <CardDescription className="text-black/70">
            Manage user accounts and statistics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Search Section */}
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="search" className="text-black">Search</Label>
              <Input
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Enter username or user ID..."
                className="bg-white border-blue-200 text-black placeholder:text-black/60"
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="w-40">
              <Label htmlFor="searchType" className="text-black">Search By</Label>
              <Select value={searchType} onValueChange={(value: SearchType) => setSearchType(value)}>
                <SelectTrigger className="bg-white border-blue-200 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="username">Username</SelectItem>
                  <SelectItem value="id">User ID</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSearch}
              className="text-white"
              style={{ backgroundColor: '#2599D4' }}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>

          {/* Users Table */}
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#2599D4' }}></div>
              <p className="text-black/70 mt-2">Loading users...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-black/70">No users found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-black">
                  <thead className="text-xs uppercase bg-white/90 text-black/70">
                    <tr>
                      <th scope="col" className="px-6 py-3">User</th>
                      <th scope="col" className="px-6 py-3">Email</th>
                      <th scope="col" className="px-6 py-3">Rating</th>
                      <th scope="col" className="px-6 py-3">Matches</th>
                      <th scope="col" className="px-6 py-3">W/L</th>
                      <th scope="col" className="px-6 py-3">Created</th>
                      <th scope="col" className="px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user._id} className="bg-white/90 border-b border-blue-200 hover:bg-blue-50">
                        <td className="px-6 py-4 flex items-center">
                          <Avatar className="h-8 w-8 mr-3">
                            <AvatarImage
                              src={getAvatarUrl(user.profile?.avatar)}
                              alt={user.username}
                            />
                            <AvatarFallback>
                              <img 
                                src="/placeholder_avatar.png"
                                alt="Profile placeholder"
                                width={40}
                                height={40}
                                className="w-full h-full object-cover"
                              />
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-black">{user.username}</div>
                            <div className="text-xs text-black/70">
                              {user.profile?.firstName} {user.profile?.lastName}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-black/70">{user.email}</td>
                        <td className="px-6 py-4 text-black/70">{user.stats?.rating?.toLocaleString() || 0}</td>
                        <td className="px-6 py-4 text-black/70">{user.stats?.totalMatches || 0}</td>
                        <td className="px-6 py-4 text-black/70">
                          {user.stats?.wins || 0}/{user.stats?.losses || 0}
                        </td>
                        <td className="px-6 py-4 text-black/70">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <Button
                            onClick={() => handleEditUser(user._id!)}
                            size="sm"
                            variant="outline"
                            className="border-blue-200 text-black hover:bg-blue-50"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center">
                  <Button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    variant="outline"
                    className="border-blue-200 text-black hover:bg-blue-50"
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Previous
                  </Button>
                  <span className="text-black/70">
                    Page {currentPage} of {totalPages} ({totalCount} total users)
                  </span>
                  <Button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    variant="outline"
                    className="border-blue-200 text-black hover:bg-blue-50"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white border-blue-200">
          <DialogHeader>
            <DialogTitle className="text-black">Edit User</DialogTitle>
            <DialogDescription className="text-black/70">
              Modify user profile and statistics
            </DialogDescription>
          </DialogHeader>
          
          {editingUser && (
            <div className="space-y-6">
              {/* Profile Section */}
              <div>
                <h3 className="text-lg font-semibold text-black mb-4">Profile Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="username" className="text-black">Username</Label>
                    <Input
                      id="username"
                      value={editingUser.username}
                      onChange={(e) => updateEditingUser('username', e.target.value)}
                      className="bg-white border-blue-200 text-black"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email" className="text-black">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={editingUser.email}
                      onChange={(e) => updateEditingUser('email', e.target.value)}
                      className="bg-white border-blue-200 text-black"
                    />
                  </div>
                  <div>
                    <Label htmlFor="firstName" className="text-black">First Name</Label>
                    <Input
                      id="firstName"
                      value={editingUser.profile?.firstName || ''}
                      onChange={(e) => updateEditingUser('profile.firstName', e.target.value)}
                      className="bg-white border-blue-200 text-black"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName" className="text-black">Last Name</Label>
                    <Input
                      id="lastName"
                      value={editingUser.profile?.lastName || ''}
                      onChange={(e) => updateEditingUser('profile.lastName', e.target.value)}
                      className="bg-white border-blue-200 text-black"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="avatar" className="text-black">Avatar URL</Label>
                    <Input
                      id="avatar"
                      value={editingUser.profile?.avatar || ''}
                      onChange={(e) => updateEditingUser('profile.avatar', e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className="bg-white border-blue-200 text-black"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="bio" className="text-black">Bio</Label>
                    <Textarea
                      id="bio"
                      value={editingUser.profile?.bio || ''}
                      onChange={(e) => updateEditingUser('profile.bio', e.target.value)}
                      placeholder="User bio..."
                      className="bg-white border-blue-200 text-black"
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* Stats Section */}
              <div>
                <h3 className="text-lg font-semibold text-black mb-4">Statistics</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <Label htmlFor="rating" className="text-black">Rating</Label>
                    <Input
                      id="rating"
                      type="number"
                      value={editingUser.stats?.rating || 0}
                      onChange={(e) => updateEditingUser('stats.rating', parseInt(e.target.value) || 0)}
                      className="bg-white border-blue-200 text-black"
                      min="0"
                      max="3000"
                    />
                  </div>
                  <div>
                    <Label htmlFor="totalMatches" className="text-black">Total Matches</Label>
                    <Input
                      id="totalMatches"
                      type="number"
                      value={editingUser.stats?.totalMatches || 0}
                      onChange={(e) => updateEditingUser('stats.totalMatches', parseInt(e.target.value) || 0)}
                      className="bg-white border-blue-200 text-black"
                      min="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="wins" className="text-black">Wins</Label>
                    <Input
                      id="wins"
                      type="number"
                      value={editingUser.stats?.wins || 0}
                      onChange={(e) => updateEditingUser('stats.wins', parseInt(e.target.value) || 0)}
                      className="bg-white border-blue-200 text-black"
                      min="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="losses" className="text-black">Losses</Label>
                    <Input
                      id="losses"
                      type="number"
                      value={editingUser.stats?.losses || 0}
                      onChange={(e) => updateEditingUser('stats.losses', parseInt(e.target.value) || 0)}
                      className="bg-white border-blue-200 text-black"
                      min="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="draws" className="text-black">Draws</Label>
                    <Input
                      id="draws"
                      type="number"
                      value={editingUser.stats?.draws || 0}
                      onChange={(e) => updateEditingUser('stats.draws', parseInt(e.target.value) || 0)}
                      className="bg-white border-blue-200 text-black"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-blue-200">
                <Button
                  onClick={() => {
                    setEditDialogOpen(false);
                    setEditingUser(null);
                  }}
                  variant="outline"
                  className="bg-white border-blue-200 text-black hover:bg-blue-50"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveUser}
                  disabled={isSaving}
                  className="text-white"
                  style={{ backgroundColor: '#2599D4' }}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
