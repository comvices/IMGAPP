/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useState, useEffect, useRef, type ReactNode } from 'react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  Timestamp,
  updateDoc,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  Camera, 
  Upload, 
  User as UserIcon, 
  BookOpen, 
  Image as ImageIcon, 
  Trash2, 
  Pencil,
  LogOut, 
  LogIn,
  Plus,
  X,
  Loader2,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Activity {
  id: string;
  activityName: string;
  learningArea: string;
  uploaderName: string;
  description: string;
  imageUrls?: string[];
  imageUrl?: string; // Fallback for old data
  createdAt: Timestamp;
  authorUid: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends (Component as any) {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">เกิดข้อผิดพลาด</h2>
            <p className="text-gray-600 mb-6">ขออภัย ระบบขัดข้องชั่วคราว</p>
            <pre className="text-xs bg-gray-100 p-4 rounded-lg text-left overflow-auto max-h-40 mb-6">
              {this.state.error?.message}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
            >
              รีโหลดหน้าเว็บ
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Constants ---
const LEARNING_AREAS = [
  "ภาษาไทย",
  "คณิตศาสตร์",
  "วิทยาศาสตร์และเทคโนโลยี",
  "สังคมศึกษา ศาสนา และวัฒนธรรม",
  "สุขศึกษาและพลศึกษา",
  "ศิลปะ",
  "การงานอาชีพ",
  "ภาษาต่างประเทศ"
];

// --- Main Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedArea, setSelectedArea] = useState<string>("ทั้งหมด");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    activityName: '',
    learningArea: LEARNING_AREAS[0],
    uploaderName: '',
    description: '',
    images: [] as { file: File | null, preview: string }[]
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setActivities([]);
      return;
    }

    const q = query(collection(db, 'activities'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Activity[];
      setActivities(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'activities');
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login Error:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout Error:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      if (file.size > 800000) { // Approx 800KB to be safe with 1MB Firestore limit
        alert(`ไฟล์ ${file.name} ใหญ่เกินไป (จำกัดไม่เกิน 800KB)`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({
          ...prev,
          images: [...prev.images, { file, preview: reader.result as string }]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || formData.images.length === 0) return;

    setIsUploading(true);
    try {
      const path = 'activities';
      const data = {
        activityName: formData.activityName,
        learningArea: formData.learningArea,
        uploaderName: formData.uploaderName,
        description: formData.description,
        imageUrls: formData.images.map(img => img.preview),
        updatedAt: serverTimestamp(),
        authorUid: user.uid
      };

      if (editingId) {
        await updateDoc(doc(db, path, editingId), data);
      } else {
        await addDoc(collection(db, path), {
          ...data,
          createdAt: serverTimestamp()
        });
      }
      
      setFormData({
        activityName: '',
        learningArea: LEARNING_AREAS[0],
        uploaderName: '',
        description: '',
        images: []
      });
      setEditingId(null);
      setShowForm(false);
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, editingId ? `activities/${editingId}` : 'activities');
    } finally {
      setIsUploading(false);
    }
  };

  const handleEdit = (activity: Activity) => {
    setFormData({
      activityName: activity.activityName,
      learningArea: activity.learningArea,
      uploaderName: activity.uploaderName,
      description: activity.description,
      images: (activity.imageUrls || (activity.imageUrl ? [activity.imageUrl] : [])).map(url => ({ file: null, preview: url }))
    });
    setEditingId(activity.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'activities', id));
      setShowDeleteConfirm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `activities/${id}`);
    }
  };

  const filteredActivities = activities.filter(activity => {
    const matchesArea = selectedArea === "ทั้งหมด" || activity.learningArea === selectedArea;
    const matchesSearch = activity.activityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         activity.uploaderName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesArea && matchesSearch;
  });

  const stats = {
    total: activities.length,
    byArea: LEARNING_AREAS.reduce((acc, area) => {
      acc[area] = activities.filter(a => a.learningArea === area).length;
      return acc;
    }, {} as Record<string, number>)
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-emerald-100">
        {/* Navigation */}
        <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-bottom border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center gap-2">
                <div className="bg-emerald-600 p-2 rounded-xl">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-gray-900 hidden sm:block">
                  คลังรูปภาพกิจกรรม
                </h1>
              </div>

              <div className="flex items-center gap-4">
                {user ? (
                  <div className="flex items-center gap-3 max-w-[150px] sm:max-w-none">
                    <div className="hidden sm:flex flex-col items-end">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[120px]">{user.displayName}</span>
                      <span className="text-xs text-gray-500 truncate max-w-[150px]">{user.email}</span>
                    </div>
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full border-2 border-emerald-100" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                        <UserIcon className="w-6 h-6 text-emerald-600" />
                      </div>
                    )}
                    <button 
                      onClick={handleLogout}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="ออกจากระบบ"
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleLogin}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
                  >
                    <LogIn className="w-5 h-5" />
                    เข้าสู่ระบบ
                  </button>
                )}
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {!user ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                <ImageIcon className="w-12 h-12 text-emerald-600" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4 tracking-tight">ยินดีต้อนรับสู่ระบบคลังรูปภาพ</h2>
              <p className="text-gray-600 max-w-md mb-8 leading-relaxed">
                กรุณาเข้าสู่ระบบด้วยบัญชี Google เพื่อเริ่มต้นการอัปโหลดและจัดการรูปภาพกิจกรรมของคุณ
              </p>
              <button 
                onClick={handleLogin}
                className="flex items-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 active:scale-95"
              >
                <LogIn className="w-6 h-6" />
                เข้าสู่ระบบด้วย Google
              </button>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Sidebar / Filters */}
              <aside className="lg:w-64 flex-shrink-0">
                <div className="sticky top-24 space-y-8">
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">เมนูหลัก</h3>
                    <button 
                      onClick={() => setShowForm(true)}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95 mb-6"
                    >
                      <Plus className="w-5 h-5" />
                      เพิ่มรูปภาพใหม่
                    </button>
                  </div>

                  {/* Mobile Menu Toggle */}
                  <button 
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="lg:hidden w-full flex items-center justify-between px-5 py-4 bg-white border-2 border-gray-100 rounded-2xl mb-4 shadow-sm active:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-emerald-50 p-2 rounded-lg">
                        <Filter className="w-4 h-4 text-emerald-600" />
                      </div>
                      <span className="font-bold text-gray-700">กลุ่มสาระการเรียนรู้</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                        {selectedArea}
                      </span>
                      {isMenuOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {(isMenuOpen || (typeof window !== 'undefined' && window.innerWidth >= 1024)) && (
                      <motion.div 
                        initial={typeof window !== 'undefined' && window.innerWidth < 1024 ? { height: 0, opacity: 0 } : false}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden lg:overflow-visible"
                      >
                        <div className="space-y-8">
                          <div>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">กลุ่มสาระการเรียนรู้</h3>
                            <nav className="space-y-1">
                              <button 
                                onClick={() => {
                                  setSelectedArea("ทั้งหมด");
                                  setIsMenuOpen(false);
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold transition-all",
                                  selectedArea === "ทั้งหมด" 
                                    ? "bg-emerald-50 text-emerald-700" 
                                    : "text-gray-600 hover:bg-gray-100"
                                )}
                              >
                                <span>ทั้งหมด</span>
                                <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md text-[10px]">{stats.total}</span>
                              </button>
                              {LEARNING_AREAS.map(area => (
                                <button 
                                  key={area}
                                  onClick={() => {
                                    setSelectedArea(area);
                                    setIsMenuOpen(false);
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold transition-all",
                                    selectedArea === area 
                                      ? "bg-emerald-50 text-emerald-700" 
                                      : "text-gray-600 hover:bg-gray-100"
                                  )}
                                >
                                  <span className="truncate mr-2">{area}</span>
                                  <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md text-[10px]">{stats.byArea[area] || 0}</span>
                                </button>
                              ))}
                            </nav>
                          </div>

                          <div className="hidden lg:block">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">สถิติการอัปโหลด</h3>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-500">ทั้งหมด</span>
                                <span className="text-lg font-bold text-emerald-600">{stats.total}</span>
                              </div>
                              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-emerald-500 transition-all duration-1000" 
                                  style={{ width: `${Math.min(100, (stats.total / 100) * 100)}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-gray-400 leading-tight">
                                จำนวนรูปภาพกิจกรรมทั้งหมดที่ถูกบันทึกไว้ในระบบคลังรูปภาพ
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </aside>

              {/* Main Content Area */}
              <div className="flex-1 min-w-0">
                {/* Dashboard Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">แดชบอร์ดกิจกรรม</h2>
                    <p className="text-sm text-gray-500">แสดงผลกิจกรรมในหมวด {selectedArea}</p>
                  </div>
                  
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="text"
                      placeholder="ค้นหาชื่อกิจกรรมหรือผู้สอน..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Stats Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">รวมทั้งหมด</p>
                    <p className="text-2xl font-bold text-emerald-600">{stats.total}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">หมวดที่เลือก</p>
                    <p className="text-2xl font-bold text-blue-600">{filteredActivities.length}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">อัปโหลดล่าสุด</p>
                    <p className="text-xs font-bold text-gray-600 mt-2 truncate">
                      {activities[0]?.activityName || '-'}
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">สถานะระบบ</p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-xs font-bold text-emerald-600">ออนไลน์</span>
                    </div>
                  </div>
                </div>

                {/* Gallery Grid */}
                {filteredActivities.length === 0 ? (
                  <div className="bg-white rounded-[2rem] border-2 border-dashed border-gray-100 py-20 text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ImageIcon className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-gray-500 font-medium">ไม่พบข้อมูลกิจกรรมที่ค้นหา</p>
                    <button 
                      onClick={() => {setSearchQuery(""); setSelectedArea("ทั้งหมด");}}
                      className="mt-4 text-emerald-600 text-sm font-bold hover:underline"
                    >
                      ล้างการค้นหา
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    <AnimatePresence mode="popLayout">
                      {filteredActivities.map((activity) => (
                        <motion.div 
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={activity.id}
                          onClick={() => setSelectedActivity(activity)}
                          className="group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                        >
                          <div className="relative aspect-[16/10] overflow-hidden bg-gray-50">
                            <img 
                              src={activity.imageUrls?.[0] || activity.imageUrl || ''} 
                              alt={activity.activityName} 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                              loading="lazy"
                            />
                            <div className="absolute top-3 left-3 flex flex-col gap-2">
                              <span className="px-2.5 py-1 bg-white/90 backdrop-blur-sm text-emerald-700 text-[10px] font-bold rounded-lg shadow-sm">
                                {activity.learningArea}
                              </span>
                            </div>
                            
                            <div className="absolute bottom-3 right-3">
                              <span className="px-2.5 py-1 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold rounded-lg flex items-center gap-1.5">
                                <ImageIcon className="w-3 h-3" />
                                {(activity.imageUrls?.length || (activity.imageUrl ? 1 : 0))} รูป
                              </span>
                            </div>

                            {user.uid === activity.authorUid && (
                              <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(activity);
                                  }}
                                  className="p-2 bg-white/90 backdrop-blur-sm text-blue-500 rounded-lg hover:bg-blue-50 shadow-sm"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDeleteConfirm(activity.id);
                                  }}
                                  className="p-2 bg-white/90 backdrop-blur-sm text-red-500 rounded-lg hover:bg-red-50 shadow-sm"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <h3 className="font-bold text-gray-900 mb-1 truncate">{activity.activityName}</h3>
                            <p className="text-[11px] text-gray-500 mb-3 line-clamp-1">{activity.description || 'ไม่มีรายละเอียด'}</p>
                            
                            <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
                                  <UserIcon className="w-3 h-3 text-emerald-600" />
                                </div>
                                <span className="text-[10px] font-medium text-gray-600 truncate max-w-[80px]">{activity.uploaderName}</span>
                              </div>
                              <span className="text-[9px] text-gray-400 font-medium">
                                {activity.createdAt?.toDate().toLocaleDateString('th-TH', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: '2-digit'
                                })}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Upload Modal */}
        <AnimatePresence>
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isUploading && setShowForm(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-xl bg-white rounded-[1.5rem] sm:rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
              >
                <div className="p-5 sm:p-8">
                  <div className="flex justify-between items-center mb-6 sm:mb-8">
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                      {editingId ? 'แก้ไขกิจกรรม' : 'อัปโหลดรูปภาพกิจกรรม'}
                    </h3>
                    <button 
                      onClick={() => {
                        setShowForm(false);
                        setEditingId(null);
                        setFormData({
                          activityName: '',
                          learningArea: LEARNING_AREAS[0],
                          uploaderName: '',
                          description: '',
                          images: []
                        });
                      }}
                      disabled={isUploading}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
                    >
                      <X className="w-6 h-6 text-gray-500" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700 ml-1">ชื่อกิจกรรม</label>
                      <div className="relative">
                        <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input 
                          required
                          type="text"
                          placeholder="ระบุชื่อกิจกรรม..."
                          value={formData.activityName}
                          onChange={e => setFormData(prev => ({ ...prev, activityName: e.target.value }))}
                          className="w-full pl-12 pr-4 py-3 sm:py-4 bg-gray-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 ml-1">กลุ่มสาระการเรียนรู้</label>
                        <select 
                          required
                          value={formData.learningArea}
                          onChange={e => setFormData(prev => ({ ...prev, learningArea: e.target.value }))}
                          className="w-full px-4 py-3 sm:py-4 bg-gray-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium appearance-none"
                        >
                          {LEARNING_AREAS.map(area => (
                            <option key={area} value={area}>{area}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 ml-1">ชื่อผู้อัปโหลด</label>
                        <div className="relative">
                          <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                          <input 
                            required
                            type="text"
                            placeholder="ชื่อของคุณ..."
                            value={formData.uploaderName}
                            onChange={e => setFormData(prev => ({ ...prev, uploaderName: e.target.value }))}
                            className="w-full pl-12 pr-4 py-3 sm:py-4 bg-gray-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700 ml-1">รายละเอียดกิจกรรม</label>
                      <textarea 
                        placeholder="ระบุรายละเอียดเพิ่มเติม..."
                        value={formData.description}
                        onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        rows={3}
                        className="w-full px-4 py-3 sm:py-4 bg-gray-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium resize-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700 ml-1">รูปภาพกิจกรรม ({formData.images.length})</label>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {formData.images.map((img, index) => (
                          <div key={index} className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 group">
                            <img src={img.preview} alt={`Preview ${index}`} className="w-full h-full object-cover" />
                            <button 
                              type="button"
                              onClick={() => removeImage(index)}
                              className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        
                        <label className="flex flex-col items-center justify-center aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 transition-all group">
                          <Plus className="w-6 h-6 text-gray-400 group-hover:text-emerald-500 transition-colors" />
                          <span className="text-[10px] font-medium text-gray-500 group-hover:text-emerald-600 mt-1">เพิ่มรูป</span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} multiple />
                        </label>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 ml-1">* สามารถเลือกได้หลายภาพ (จำกัดขนาดภาพละไม่เกิน 800KB)</p>
                    </div>

                    <button 
                      type="submit"
                      disabled={isUploading || formData.images.length === 0}
                      className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          {editingId ? 'กำลังบันทึกการแก้ไข...' : `กำลังอัปโหลด (${formData.images.length} รูป)...`}
                        </>
                      ) : (
                        <>
                          <Upload className="w-6 h-6" />
                          {editingId ? 'บันทึกการแก้ไข' : 'บันทึกข้อมูลทั้งหมด'}
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <footer className="mt-20 py-10 border-t border-gray-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 text-center">
            <p className="text-gray-400 text-sm font-medium">
              &copy; {new Date().getFullYear()} ระบบคลังรูปภาพกิจกรรม • นายปราชญ์ฺชยาวิช  ศรีก่อเกื้อ
            </p>
          </div>
        </footer>
        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowDeleteConfirm(null)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 text-center"
              >
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบกิจกรรม?</h3>
                <p className="text-sm text-gray-500 mb-6">คุณกำลังจะลบกิจกรรมและรูปภาพทั้งหมดในอัลบั้มนี้ การดำเนินการนี้ไม่สามารถย้อนกลับได้</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    ยกเลิก
                  </button>
                  <button 
                    onClick={() => handleDelete(showDeleteConfirm)}
                    className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-100"
                  >
                    ลบเลย
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Album Viewer Modal */}
        <AnimatePresence>
          {selectedActivity && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedActivity(null)}
                className="absolute inset-0 bg-black/90 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative w-full max-w-5xl bg-white rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              >
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{selectedActivity.activityName}</h3>
                    <p className="text-sm text-gray-500">{selectedActivity.learningArea} • {(selectedActivity.imageUrls?.length || (selectedActivity.imageUrl ? 1 : 0))} รูปภาพ</p>
                  </div>
                  <button 
                    onClick={() => setSelectedActivity(null)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-gray-500" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(selectedActivity.imageUrls || (selectedActivity.imageUrl ? [selectedActivity.imageUrl] : [])).map((url, idx) => (
                      <div key={idx} className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gray-100">
                        <img 
                          src={url} 
                          alt={`${selectedActivity.activityName} ${idx + 1}`} 
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ))}
                  </div>
                  {selectedActivity.description && (
                    <div className="mt-8 p-6 bg-gray-50 rounded-2xl">
                      <h4 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wider">รายละเอียดกิจกรรม</h4>
                      <p className="text-gray-600 leading-relaxed">{selectedActivity.description}</p>
                    </div>
                  )}
                </div>
                
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <UserIcon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900">{selectedActivity.uploaderName}</p>
                      <p className="text-[10px] text-gray-500">ผู้อัปโหลด</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-400">
                    {selectedActivity.createdAt?.toDate().toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </span>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
