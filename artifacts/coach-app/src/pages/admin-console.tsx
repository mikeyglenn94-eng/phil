import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function authHeaders(token: string | null) {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

type NavItem = "users" | "athlete-linking" | "irl-sessions" | "content" | "billing" | "audit";
type AthleteFilter = "all" | "online" | "irl";

interface User {
  id: number;
  email: string;
  roles: string[];
  clientId: number | null;
  irlClient: boolean | null;
  status: "login_created" | "active";
  lastLoginAt: string | null;
  createdAt: string;
}

type UserFilter = "all" | "online" | "irl";

interface AthleteLink {
  clientId: number;
  clientName: string;
  loginEmail: string | null;
  userId: number | null;
  irlClient: boolean;
  status: "no_login" | "login_created" | "active";
}

interface IrlSlot {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  location: string | null;
  coachNote: string | null;
  status: string;
  createdAt: string;
}

interface IrlBookingRow {
  booking: {
    id: number;
    slotId: number;
    clientId: number;
    creditsUsed: number;
    status: string;
    cancelledAt: string | null;
    cancellationNote: string | null;
    creditRefunded: boolean;
    createdAt: string;
  };
  slot: IrlSlot | null;
  client: { id: number; name: string } | null;
}

interface CreditLedgerEntry {
  id: number;
  delta: number;
  type: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

const STATUS_COLOURS: Record<string, string> = {
  no_login: "bg-white/5 text-white/40",
  login_created: "bg-amber-500/15 text-amber-400",
  active: "bg-emerald-500/15 text-emerald-400",
};
const STATUS_LABELS: Record<string, string> = {
  no_login: "No login",
  login_created: "Login created",
  active: "Active",
};

function RoleBadge({ role }: { role: string }) {
  const c = role === "admin" ? "bg-purple-500/15 text-purple-300" : role === "coach" ? "bg-blue-500/15 text-blue-300" : "bg-white/10 text-white/50";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c}`}>{role}</span>;
}

function SlotStatusBadge({ status }: { status: string }) {
  const c = status === "open" ? "bg-emerald-500/15 text-emerald-400" : status === "booked" ? "bg-blue-500/15 text-blue-300" : "bg-white/10 text-white/40";
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${c}`}>{status}</span>;
}

function BookingStatusBadge({ status }: { status: string }) {
  const c = status === "confirmed" ? "bg-emerald-500/15 text-emerald-400" : status === "cancelled" ? "bg-red-500/15 text-red-400" : status === "completed" ? "bg-blue-500/15 text-blue-300" : "bg-white/10 text-white/40";
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${c}`}>{status}</span>;
}

export default function AdminConsole() {
  const { token, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [nav, setNav] = useState<NavItem>("athlete-linking");

  // Users
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"athlete" | "coach" | "admin">("athlete");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [resetPw, setResetPw] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [userSearch, setUserSearch] = useState("");
  const [userIrlExpandedId, setUserIrlExpandedId] = useState<number | null>(null);
  const [userIrlBalances, setUserIrlBalances] = useState<Record<number, { balance: number; ledger: CreditLedgerEntry[] }>>({});
  const [userIrlCreditDelta, setUserIrlCreditDelta] = useState("");
  const [userIrlCreditNote, setUserIrlCreditNote] = useState("");

  // Athlete linking
  const [athletes, setAthletes] = useState<AthleteLink[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [athleteSearch, setAthleteSearch] = useState("");
  const [athleteFilter, setAthleteFilter] = useState<AthleteFilter>("all");
  const [irlExpandedId, setIrlExpandedId] = useState<number | null>(null);
  const [irlCreditDelta, setIrlCreditDelta] = useState("");
  const [irlCreditNote, setIrlCreditNote] = useState("");
  const [irlBalances, setIrlBalances] = useState<Record<number, { balance: number; ledger: CreditLedgerEntry[] }>>({});

  // IRL slots
  const [slots, setSlots] = useState<IrlSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [showNewSlot, setShowNewSlot] = useState(false);
  const [slotView, setSlotView] = useState<"upcoming" | "all">("upcoming");
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editSlot, setEditSlot] = useState<Partial<IrlSlot>>({});
  // Creation form state
  const [createMode, setCreateMode] = useState<"single" | "hourly">("single");
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [slotDate, setSlotDate] = useState("");
  const [slotStart, setSlotStart] = useState("09:00");
  const [slotEnd, setSlotEnd] = useState("10:00");
  const [slotNote, setSlotNote] = useState("");
  const [recurStart, setRecurStart] = useState("");
  const [recurEnd, setRecurEnd] = useState("");
  const [recurWeekdays, setRecurWeekdays] = useState<number[]>([]);
  const [windowStart, setWindowStart] = useState("06:00");
  const [windowEnd, setWindowEnd] = useState("12:00");
  const [previewSlots, setPreviewSlots] = useState<Array<{ date: string; startTime: string; endTime: string }> | null>(null);
  const [creatingSlots, setCreatingSlots] = useState(false);

  // IRL bookings
  const [bookings, setBookings] = useState<IrlBookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(null);
  const [manualBookSlot, setManualBookSlot] = useState("");
  const [manualBookClient, setManualBookClient] = useState("");
  const [showManualBook, setShowManualBook] = useState(false);
  const [irlSubTab, setIrlSubTab] = useState<"slots" | "bookings">("slots");

  // ── Fetch functions ───────────────────────────────────────────────────────

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/users`, { headers: authHeaders(token) });
      if (r.ok) setUsers(await r.json());
    } finally { setUsersLoading(false); }
  };

  const fetchAthletes = async () => {
    setAthletesLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/athlete-linking`, { headers: authHeaders(token) });
      if (r.ok) setAthletes(await r.json());
    } finally { setAthletesLoading(false); }
  };

  const fetchIrlCredits = async (clientId: number) => {
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-credits`, { headers: authHeaders(token) });
    if (r.ok) {
      const data = await r.json();
      setIrlBalances(prev => ({ ...prev, [clientId]: data }));
    }
  };

  const fetchSlots = async () => {
    setSlotsLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/irl-slots`, { headers: authHeaders(token) });
      if (r.ok) setSlots(await r.json());
    } finally { setSlotsLoading(false); }
  };

  const fetchBookings = async () => {
    setBookingsLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/irl-bookings`, { headers: authHeaders(token) });
      if (r.ok) setBookings(await r.json());
    } finally { setBookingsLoading(false); }
  };

  useEffect(() => { if (nav === "users") fetchUsers(); }, [nav]);
  useEffect(() => { if (nav === "athlete-linking") fetchAthletes(); }, [nav]);
  useEffect(() => { if (nav === "irl-sessions") { fetchSlots(); fetchBookings(); } }, [nav]);

  // ── User actions ──────────────────────────────────────────────────────────

  const createUser = async () => {
    if (!newUserEmail || !newUserPassword) return;
    const r = await fetch(`${BASE}/api/admin/users`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ email: newUserEmail, password: newUserPassword, roles: [newUserRole] }),
    });
    const data = await r.json();
    if (!r.ok) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
    toast({ title: "User created" });
    setNewUserEmail(""); setNewUserPassword("");
    fetchUsers();
  };

  const saveUserEdit = async () => {
    if (!editingUser) return;
    const r = await fetch(`${BASE}/api/admin/users/${editingUser.id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ roles: editRoles }),
    });
    if (r.ok) { toast({ title: "Saved" }); setEditingUser(null); fetchUsers(); }
  };

  const doResetPassword = async (userId: number) => {
    if (!resetPw || resetPw.length < 8) { toast({ title: "Password must be 8+ characters", variant: "destructive" }); return; }
    const r = await fetch(`${BASE}/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: resetPw }),
    });
    if (r.ok) { toast({ title: "Password reset" }); setResetPw(""); setEditingUser(null); }
  };

  // ── Athlete linking actions ───────────────────────────────────────────────

  const createAthleteLogin = async (clientId: number) => {
    if (!linkEmail || !linkPassword) { toast({ title: "Email and password required", variant: "destructive" }); return; }
    const r = await fetch(`${BASE}/api/admin/athlete-linking/${clientId}/create-login`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ email: linkEmail, password: linkPassword }),
    });
    const data = await r.json();
    if (!r.ok) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
    toast({ title: "Login created", description: `${linkEmail} can now sign in` });
    setLinkingId(null); setLinkEmail(""); setLinkPassword("");
    fetchAthletes();
  };

  const updateAthleteLogin = async (clientId: number) => {
    if (!linkEmail && !linkPassword) return;
    const body: Record<string, string> = {};
    if (linkEmail) body.email = linkEmail;
    if (linkPassword) body.password = linkPassword;
    const r = await fetch(`${BASE}/api/admin/athlete-linking/${clientId}/update-login`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (r.ok) { toast({ title: "Updated" }); setLinkingId(null); setLinkEmail(""); setLinkPassword(""); fetchAthletes(); }
    else { const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); }
  };

  const toggleIrlClient = async (clientId: number, irlClient: boolean) => {
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-settings`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ irlClient }),
    });
    if (r.ok) {
      toast({ title: irlClient ? "IRL enabled" : "IRL disabled" });
      fetchAthletes();
    } else {
      toast({ title: "Error updating IRL status", variant: "destructive" });
    }
  };

  const addIrlCredits = async (clientId: number) => {
    const delta = parseInt(irlCreditDelta, 10);
    if (!delta || isNaN(delta)) { toast({ title: "Enter a valid credit amount", variant: "destructive" }); return; }
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-credits`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ delta, type: delta > 0 ? "manual_add" : "manual_adjustment", note: irlCreditNote || null }),
    });
    if (r.ok) {
      toast({ title: delta > 0 ? `+${delta} credits added` : `${delta} credits adjusted` });
      setIrlCreditDelta(""); setIrlCreditNote("");
      fetchIrlCredits(clientId);
    } else {
      const d = await r.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  // ── IRL helpers for All Users section ────────────────────────────────────

  const fetchUserIrlCredits = async (clientId: number) => {
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-credits`, { headers: authHeaders(token) });
    if (r.ok) {
      const d = await r.json();
      setUserIrlBalances(prev => ({ ...prev, [clientId]: { balance: d.balance, ledger: d.ledger } }));
    }
  };

  const toggleUserIrlClient = async (userId: number, clientId: number, irlClient: boolean) => {
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-settings`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ irlClient }),
    });
    if (r.ok) {
      toast({ title: irlClient ? "IRL enabled" : "IRL disabled" });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, irlClient } : u));
    } else {
      toast({ title: "Error updating IRL status", variant: "destructive" });
    }
  };

  const addUserIrlCredits = async (clientId: number) => {
    const delta = parseInt(userIrlCreditDelta, 10);
    if (!delta || isNaN(delta)) { toast({ title: "Enter a valid credit amount", variant: "destructive" }); return; }
    const r = await fetch(`${BASE}/api/admin/clients/${clientId}/irl-credits`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ delta, type: delta > 0 ? "manual_add" : "manual_adjustment", note: userIrlCreditNote || null }),
    });
    if (r.ok) {
      toast({ title: delta > 0 ? `+${delta} credits added` : `${delta} credits adjusted` });
      setUserIrlCreditDelta(""); setUserIrlCreditNote("");
      fetchUserIrlCredits(clientId);
    } else {
      const d = await r.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  // ── IRL slot generation ───────────────────────────────────────────────────

  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const minutesToTime = (m: number) => {
    const hh = Math.floor(m / 60).toString().padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    return `${hh}:${mm}`;
  };
  const generatePreviewSlots = (): Array<{ date: string; startTime: string; endTime: string }> => {
    const results: Array<{ date: string; startTime: string; endTime: string }> = [];

    const buildSlotsForDate = (date: string) => {
      if (createMode === "single") {
        results.push({ date, startTime: slotStart, endTime: slotEnd });
      } else {
        const winStartMin = timeToMinutes(windowStart);
        const winEndMin = timeToMinutes(windowEnd);
        let cur = winStartMin;
        while (cur + 60 <= winEndMin) {
          results.push({ date, startTime: minutesToTime(cur), endTime: minutesToTime(cur + 60) });
          cur += 60;
        }
      }
    };

    if (!repeatWeekly) {
      if (slotDate) buildSlotsForDate(slotDate);
    } else {
      if (!recurStart || !recurEnd || recurWeekdays.length === 0) return [];
      const start = new Date(recurStart + "T00:00:00");
      const end = new Date(recurEnd + "T00:00:00");
      if (end < start) return [];
      const cur = new Date(start);
      while (cur <= end) {
        const jsDay = cur.getDay();
        const monDay = jsDay === 0 ? 6 : jsDay - 1;
        if (recurWeekdays.includes(monDay)) {
          const yyyy = cur.getFullYear();
          const mm = String(cur.getMonth() + 1).padStart(2, "0");
          const dd = String(cur.getDate()).padStart(2, "0");
          buildSlotsForDate(`${yyyy}-${mm}-${dd}`);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    return results;
  };

  const handlePreview = () => {
    const slots = generatePreviewSlots();
    if (slots.length === 0) {
      toast({ title: "No slots generated", description: "Check your settings", variant: "destructive" }); return;
    }
    setPreviewSlots(slots);
  };

  const resetSlotForm = () => {
    setCreateMode("single"); setRepeatWeekly(false);
    setSlotDate(""); setSlotStart("09:00"); setSlotEnd("10:00"); setSlotNote("");
    setRecurStart(""); setRecurEnd(""); setRecurWeekdays([]);
    setWindowStart("06:00"); setWindowEnd("12:00");
    setPreviewSlots(null);
  };

  // ── IRL slot actions ──────────────────────────────────────────────────────

  const createSlots = async () => {
    const toCreate = previewSlots ?? generatePreviewSlots();
    if (toCreate.length === 0) {
      toast({ title: "No slots to create", variant: "destructive" }); return;
    }
    setCreatingSlots(true);
    try {
      const r = await fetch(`${BASE}/api/admin/irl-slots`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ slots: toCreate, coachNote: slotNote || undefined }),
      });
      if (r.ok) {
        const created = await r.json();
        toast({ title: `${created.length} slot${created.length !== 1 ? "s" : ""} created` });
        resetSlotForm();
        setShowNewSlot(false);
        fetchSlots();
      } else {
        const d = await r.json();
        toast({ title: "Error", description: d.error, variant: "destructive" });
      }
    } finally { setCreatingSlots(false); }
  };

  const updateSlot = async (slotId: number) => {
    const r = await fetch(`${BASE}/api/admin/irl-slots/${slotId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(editSlot),
    });
    if (r.ok) { toast({ title: "Slot updated" }); setEditingSlotId(null); fetchSlots(); }
    else { const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); }
  };

  const cancelSlot = async (slotId: number) => {
    const r = await fetch(`${BASE}/api/admin/irl-slots/${slotId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (r.ok) { toast({ title: "Slot cancelled" }); fetchSlots(); }
  };

  const deleteSlot = async (slotId: number) => {
    if (!confirm("Delete this slot?")) return;
    const r = await fetch(`${BASE}/api/admin/irl-slots/${slotId}`, { method: "DELETE", headers: authHeaders(token) });
    if (r.ok) { toast({ title: "Slot deleted" }); fetchSlots(); }
    else { const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); }
  };

  // ── IRL booking actions ───────────────────────────────────────────────────

  const createManualBooking = async () => {
    const slotId = parseInt(manualBookSlot, 10);
    const clientId = parseInt(manualBookClient, 10);
    if (!slotId || !clientId) { toast({ title: "Select slot and client", variant: "destructive" }); return; }
    const r = await fetch(`${BASE}/api/admin/irl-bookings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ slotId, clientId }),
    });
    if (r.ok) {
      toast({ title: "Booking created" });
      setManualBookSlot(""); setManualBookClient(""); setShowManualBook(false);
      fetchBookings(); fetchSlots();
    } else {
      const d = await r.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  const cancelBooking = async (bookingId: number, refund: boolean) => {
    if (!confirm(`Cancel booking${refund ? " and refund credits" : " (no refund)"}?`)) return;
    const r = await fetch(`${BASE}/api/admin/irl-bookings/${bookingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status: "cancelled", refundCredits: refund }),
    });
    if (r.ok) { toast({ title: "Booking cancelled" }); fetchBookings(); fetchSlots(); }
  };

  const markBookingStatus = async (bookingId: number, status: string) => {
    const r = await fetch(`${BASE}/api/admin/irl-bookings/${bookingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status }),
    });
    if (r.ok) { toast({ title: `Marked as ${status}` }); fetchBookings(); }
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  const filteredAthletes = athletes
    .filter(a => athleteFilter === "all" ? true : athleteFilter === "irl" ? a.irlClient : !a.irlClient)
    .filter(a =>
      a.clientName.toLowerCase().includes(athleteSearch.toLowerCase()) ||
      (a.loginEmail ?? "").toLowerCase().includes(athleteSearch.toLowerCase())
    );

  const today = new Date().toISOString().slice(0, 10);
  const visibleSlots = slotView === "upcoming" ? slots.filter(s => s.date >= today) : slots;
  const irlClients = athletes.filter(a => a.irlClient);
  const openSlots = slots.filter(s => s.status === "open");

  const navItems: { id: NavItem; label: string }[] = [
    { id: "athlete-linking", label: "Athlete Accounts" },
    { id: "users", label: "All Users" },
    { id: "irl-sessions", label: "IRL Sessions" },
    { id: "content", label: "Brain / Content" },
    { id: "billing", label: "Billing" },
    { id: "audit", label: "Audit Log" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-white/10 flex flex-col py-6 px-4">
        <div className="mb-8">
          <div className="text-lg font-semibold tracking-tight">MG Coaching</div>
          <div className="text-white/30 text-xs mt-0.5">Admin Console</div>
        </div>
        <nav className="space-y-1 flex-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setNav(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                nav === item.id ? "bg-white/10 text-white font-medium" : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-4 space-y-2">
          <button
            onClick={() => setLocation("/clients")}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            My Clients
          </button>
          <button
            onClick={() => { logout(); setLocation("/"); }}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-white/30 hover:text-red-400 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">

          {/* ── Athlete Accounts ─────────────────────────────────────────── */}
          {nav === "athlete-linking" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">Athlete Accounts</h1>
                <p className="text-white/40 text-sm mt-1">Link login credentials to existing athlete profiles</p>
              </div>

              {/* Search + filter */}
              <div className="flex gap-3 mb-5">
                <Input
                  placeholder="Search athletes…"
                  value={athleteSearch}
                  onChange={e => setAthleteSearch(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 max-w-xs"
                />
                <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
                  {(["all", "online", "irl"] as AthleteFilter[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setAthleteFilter(f)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${athleteFilter === f ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}
                    >
                      {f === "all" ? "All" : f === "online" ? "Online only" : "IRL enabled"}
                    </button>
                  ))}
                </div>
              </div>

              {athletesLoading ? (
                <div className="text-white/30 text-sm">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {filteredAthletes.map(a => (
                    <div key={a.clientId} className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{a.clientName}</span>
                            {a.irlClient && (
                              <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 font-medium">IRL</span>
                            )}
                          </div>
                          <div className="text-white/40 text-sm mt-0.5">{a.loginEmail ?? "No login email"}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className={`text-xs px-2 py-1 rounded-md font-medium ${STATUS_COLOURS[a.status]}`}>
                            {STATUS_LABELS[a.status]}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setIrlExpandedId(irlExpandedId === a.clientId ? null : a.clientId);
                              if (irlExpandedId !== a.clientId) fetchIrlCredits(a.clientId);
                            }}
                            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs"
                          >
                            IRL
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setLinkingId(linkingId === a.clientId ? null : a.clientId); setLinkEmail(a.loginEmail ?? ""); setLinkPassword(""); }}
                            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs"
                          >
                            {a.userId ? "Edit Login" : "Create Login"}
                          </Button>
                        </div>
                      </div>

                      {/* IRL settings panel */}
                      {irlExpandedId === a.clientId && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">IRL Client</div>
                              <div className="text-white/40 text-xs mt-0.5">Allow this athlete to access IRL session booking</div>
                            </div>
                            <button
                              onClick={() => toggleIrlClient(a.clientId, !a.irlClient)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${a.irlClient ? "bg-violet-500" : "bg-white/10"}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${a.irlClient ? "translate-x-6" : "translate-x-1"}`} />
                            </button>
                          </div>

                          {a.irlClient && (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <div className="text-sm font-medium">IRL Credits</div>
                                <div className="text-xl font-bold text-violet-300">
                                  {irlBalances[a.clientId]?.balance ?? "—"}
                                </div>
                              </div>
                              <div className="flex gap-2 mb-3">
                                <Input
                                  type="number"
                                  placeholder="+5 or -1"
                                  value={irlCreditDelta}
                                  onChange={e => setIrlCreditDelta(e.target.value)}
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-sm w-28"
                                />
                                <Input
                                  placeholder="Note (optional)"
                                  value={irlCreditNote}
                                  onChange={e => setIrlCreditNote(e.target.value)}
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-sm flex-1"
                                />
                                <Button size="sm" onClick={() => addIrlCredits(a.clientId)} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs h-8">
                                  Add
                                </Button>
                              </div>
                              {irlBalances[a.clientId]?.ledger?.length > 0 && (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {irlBalances[a.clientId].ledger.map(e => (
                                    <div key={e.id} className="flex items-center justify-between text-xs text-white/50 py-1 border-b border-white/5">
                                      <div>
                                        <span className={`font-medium mr-1.5 ${e.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                          {e.delta > 0 ? `+${e.delta}` : e.delta}
                                        </span>
                                        <span className="text-white/40">{e.type.replace(/_/g, " ")}</span>
                                        {e.note && <span className="ml-1 text-white/30">— {e.note}</span>}
                                      </div>
                                      <span className="shrink-0 ml-2">{new Date(e.createdAt).toLocaleDateString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Login panel */}
                      {linkingId === a.clientId && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-white/40 text-xs uppercase tracking-wider block mb-1">Email</label>
                              <Input
                                type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                                placeholder="athlete@example.com"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-white/40 text-xs uppercase tracking-wider block mb-1">
                                {a.userId ? "New password (leave blank to keep)" : "Password"}
                              </label>
                              <Input
                                type="password" value={linkPassword} onChange={e => setLinkPassword(e.target.value)}
                                placeholder="Min 8 characters"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => a.userId ? updateAthleteLogin(a.clientId) : createAthleteLogin(a.clientId)}
                              className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs"
                            >
                              {a.userId ? "Save changes" : "Create login"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setLinkingId(null)} className="text-white/40 text-xs">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredAthletes.length === 0 && (
                    <div className="text-white/30 text-sm py-8 text-center">No athletes found</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── All Users ────────────────────────────────────────────────── */}
          {nav === "users" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">All Users</h1>
                <p className="text-white/40 text-sm mt-1">Manage accounts, roles, passwords, and IRL access</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-5 mb-6">
                <h2 className="text-sm font-medium mb-4">Create new user</h2>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <Input
                    type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                    placeholder="Email" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
                  />
                  <Input
                    type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)}
                    placeholder="Password (8+ chars)" className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
                  />
                  <select
                    value={newUserRole}
                    onChange={e => setNewUserRole(e.target.value as "athlete" | "coach" | "admin")}
                    className="bg-white/5 border border-white/10 text-white rounded-md px-3 h-9 text-sm"
                  >
                    <option value="athlete">Athlete</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button size="sm" onClick={createUser} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                  Create user
                </Button>
              </div>

              {/* Search + filter */}
              <div className="flex gap-3 mb-5">
                <Input
                  placeholder="Search by email…"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 max-w-xs"
                />
                <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
                  {(["all", "online", "irl"] as UserFilter[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setUserFilter(f)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${userFilter === f ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}
                    >
                      {f === "all" ? "All" : f === "online" ? "Online only" : "IRL enabled"}
                    </button>
                  ))}
                </div>
              </div>

              {usersLoading ? (
                <div className="text-white/30 text-sm">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {users
                    .filter(u => {
                      const isAthlete = u.roles.includes("athlete");
                      if (userFilter === "irl") return isAthlete && u.irlClient === true;
                      if (userFilter === "online") return isAthlete && !u.irlClient;
                      return true;
                    })
                    .filter(u => u.email.toLowerCase().includes(userSearch.toLowerCase()))
                    .map(u => (
                    <div key={u.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{u.email}</span>
                            {u.roles.map(r => <RoleBadge key={r} role={r} />)}
                            {u.irlClient === true && (
                              <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 font-medium">IRL</span>
                            )}
                            {u.irlClient === false && u.roles.includes("athlete") && (
                              <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-white/30 font-medium">Online only</span>
                            )}
                          </div>
                          <div className="text-white/30 text-xs mt-0.5">
                            {u.lastLoginAt ? `Last login ${new Date(u.lastLoginAt).toLocaleDateString()}` : "Never signed in"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-md font-medium ${STATUS_COLOURS[u.status]}`}>
                            {STATUS_LABELS[u.status]}
                          </span>
                          {u.clientId != null && (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => {
                                const newId = userIrlExpandedId === u.id ? null : u.id;
                                setUserIrlExpandedId(newId);
                                if (newId && u.clientId) fetchUserIrlCredits(u.clientId);
                              }}
                              className={`border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs ${u.irlClient ? "text-violet-300 border-violet-500/30" : ""}`}
                            >
                              IRL
                            </Button>
                          )}
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setEditingUser(editingUser?.id === u.id ? null : u); setEditRoles([...u.roles]); setResetPw(""); }}
                            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs"
                          >
                            Edit
                          </Button>
                        </div>
                      </div>

                      {/* IRL settings panel */}
                      {userIrlExpandedId === u.id && u.clientId != null && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">IRL Client</div>
                              <div className="text-white/40 text-xs mt-0.5">Allow this athlete to access IRL session booking</div>
                            </div>
                            <button
                              onClick={() => toggleUserIrlClient(u.id, u.clientId!, !u.irlClient)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${u.irlClient ? "bg-violet-500" : "bg-white/10"}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${u.irlClient ? "translate-x-6" : "translate-x-1"}`} />
                            </button>
                          </div>
                          {u.irlClient && (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <div className="text-sm font-medium">IRL Credits</div>
                                <div className="text-xl font-bold text-violet-300">
                                  {userIrlBalances[u.clientId]?.balance ?? "—"}
                                </div>
                              </div>
                              <div className="flex gap-2 mb-3">
                                <Input
                                  type="number"
                                  placeholder="+5 or -1"
                                  value={userIrlCreditDelta}
                                  onChange={e => setUserIrlCreditDelta(e.target.value)}
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-sm w-28"
                                />
                                <Input
                                  placeholder="Note (optional)"
                                  value={userIrlCreditNote}
                                  onChange={e => setUserIrlCreditNote(e.target.value)}
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-sm flex-1"
                                />
                                <Button size="sm" onClick={() => addUserIrlCredits(u.clientId!)} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs h-8">
                                  Add
                                </Button>
                              </div>
                              {userIrlBalances[u.clientId]?.ledger?.length > 0 && (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {userIrlBalances[u.clientId].ledger.map(e => (
                                    <div key={e.id} className="flex items-center justify-between text-xs text-white/50">
                                      <span>{e.note ?? e.type}</span>
                                      <span className={e.delta > 0 ? "text-green-400" : "text-red-400"}>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {editingUser?.id === u.id && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                          <div>
                            <label className="text-white/40 text-xs uppercase tracking-wider block mb-2">Roles</label>
                            <div className="flex gap-2">
                              {(["athlete", "coach", "admin"] as const).map(r => (
                                <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editRoles.includes(r)}
                                    onChange={e => setEditRoles(prev =>
                                      e.target.checked ? [...prev, r] : prev.filter(x => x !== r)
                                    )}
                                    className="accent-white"
                                  />
                                  <span className="text-sm text-white/70 capitalize">{r}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-white/40 text-xs uppercase tracking-wider block mb-2">Reset Password</label>
                            <div className="flex gap-2">
                              <Input
                                type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
                                placeholder="New password (8+ chars)"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm max-w-xs"
                              />
                              <Button size="sm" variant="outline" onClick={() => doResetPassword(u.id)} className="border-white/20 text-white/70 text-xs">
                                Reset
                              </Button>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveUserEdit} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                              Save roles
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingUser(null)} className="text-white/40 text-xs">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {users.length === 0 && <div className="text-white/30 text-sm py-8 text-center">No users yet</div>}
                </div>
              )}
            </div>
          )}

          {/* ── IRL Sessions ─────────────────────────────────────────────── */}
          {nav === "irl-sessions" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">IRL Sessions</h1>
                <p className="text-white/40 text-sm mt-1">Manage in-person availability, bookings, and credits</p>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10 w-fit mb-6">
                {(["slots", "bookings"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setIrlSubTab(t)}
                    className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${irlSubTab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}
                  >
                    {t === "slots" ? "Availability" : "Bookings"}
                  </button>
                ))}
              </div>

              {/* ── Availability Slots ── */}
              {irlSubTab === "slots" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
                      {(["upcoming", "all"] as const).map(v => (
                        <button key={v} onClick={() => setSlotView(v)}
                          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${slotView === v ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
                          {v === "upcoming" ? "Upcoming" : "All"}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" onClick={() => setShowNewSlot(!showNewSlot)} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                      + New slot
                    </Button>
                  </div>

                  {showNewSlot && (
                    <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
                      <h3 className="text-sm font-medium">New availability (60 min slots)</h3>

                      {/* Creation mode */}
                      <div>
                        <label className="text-white/40 text-xs block mb-2">Creation type</label>
                        <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10 w-fit">
                          {(["single", "hourly"] as const).map(m => (
                            <button key={m} onClick={() => { setCreateMode(m); setPreviewSlots(null); }}
                              className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${createMode === m ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
                              {m === "single" ? "Single slot" : "Hourly block"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Repeat toggle */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setRepeatWeekly(p => !p); setPreviewSlots(null); }}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${repeatWeekly ? "bg-white" : "bg-white/20"}`}>
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#0a0a0a] transition-transform ${repeatWeekly ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                        <span className="text-xs text-white/60">Repeat weekly</span>
                      </div>

                      {/* Non-repeating: date + time fields */}
                      {!repeatWeekly && (
                        <div className={`grid gap-3 ${createMode === "hourly" ? "grid-cols-3" : "grid-cols-3"}`}>
                          <div>
                            <label className="text-white/40 text-xs block mb-1">Date</label>
                            <Input type="date" value={slotDate} onChange={e => { setSlotDate(e.target.value); setPreviewSlots(null); }}
                              className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                          </div>
                          {createMode === "single" ? (
                            <>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Start</label>
                                <Input type="time" value={slotStart} onChange={e => { setSlotStart(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">End</label>
                                <Input type="time" value={slotEnd} onChange={e => { setSlotEnd(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Window start</label>
                                <Input type="time" value={windowStart} onChange={e => { setWindowStart(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Window end</label>
                                <Input type="time" value={windowEnd} onChange={e => { setWindowEnd(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Repeating: weekday selector + date range + time */}
                      {repeatWeekly && (
                        <div className="space-y-3">
                          <div>
                            <label className="text-white/40 text-xs block mb-2">Weekdays</label>
                            <div className="flex gap-1.5">
                              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
                                <button key={d} onClick={() => { setRecurWeekdays(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i]); setPreviewSlots(null); }}
                                  className={`w-9 h-9 rounded text-xs font-medium transition-colors ${recurWeekdays.includes(i) ? "bg-white text-[#0a0a0a]" : "bg-white/10 text-white/50 hover:bg-white/20"}`}>
                                  {d}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-white/40 text-xs block mb-1">From date</label>
                              <Input type="date" value={recurStart} onChange={e => { setRecurStart(e.target.value); setPreviewSlots(null); }}
                                className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                            </div>
                            <div>
                              <label className="text-white/40 text-xs block mb-1">To date</label>
                              <Input type="date" value={recurEnd} onChange={e => { setRecurEnd(e.target.value); setPreviewSlots(null); }}
                                className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                            </div>
                          </div>
                          {createMode === "single" ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Start time</label>
                                <Input type="time" value={slotStart} onChange={e => { setSlotStart(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">End time</label>
                                <Input type="time" value={slotEnd} onChange={e => { setSlotEnd(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Window start</label>
                                <Input type="time" value={windowStart} onChange={e => { setWindowStart(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                              <div>
                                <label className="text-white/40 text-xs block mb-1">Window end</label>
                                <Input type="time" value={windowEnd} onChange={e => { setWindowEnd(e.target.value); setPreviewSlots(null); }}
                                  className="bg-white/5 border-white/10 text-white h-9 text-sm" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Note */}
                      <div>
                        <label className="text-white/40 text-xs block mb-1">Note (optional)</label>
                        <Input placeholder="Internal note" value={slotNote} onChange={e => setSlotNote(e.target.value)}
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm" />
                      </div>

                      {/* Preview list */}
                      {previewSlots && (
                        <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                          <div className="text-xs text-white/50 mb-2 font-medium">{previewSlots.length} slot{previewSlots.length !== 1 ? "s" : ""} will be created:</div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {previewSlots.slice(0, 50).map((s, i) => (
                              <div key={i} className="text-xs text-white/70">
                                {new Date(s.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {s.startTime} – {s.endTime}
                              </div>
                            ))}
                            {previewSlots.length > 50 && <div className="text-xs text-white/30">…and {previewSlots.length - 50} more</div>}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {!previewSlots ? (
                          <Button size="sm" onClick={handlePreview} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                            Preview slots
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" onClick={createSlots} disabled={creatingSlots} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                              {creatingSlots ? "Creating…" : `Confirm & create ${previewSlots.length} slot${previewSlots.length !== 1 ? "s" : ""}`}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPreviewSlots(null)} className="text-white/40 text-xs">Edit</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { resetSlotForm(); setShowNewSlot(false); }} className="text-white/40 text-xs">Cancel</Button>
                      </div>
                    </div>
                  )}

                  {slotsLoading ? <div className="text-white/30 text-sm">Loading…</div> : (
                    <div className="space-y-2">
                      {visibleSlots.length === 0 && <div className="text-white/30 text-sm py-8 text-center">No slots found</div>}
                      {visibleSlots.map(slot => (
                        <div key={slot.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{new Date(slot.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                                <span className="text-white/50 text-sm">{slot.startTime} – {slot.endTime}</span>
                                <SlotStatusBadge status={slot.status} />
                              </div>
                              {slot.coachNote && <div className="text-white/30 text-xs mt-0.5 italic">{slot.coachNote}</div>}
                            </div>
                            <div className="flex gap-2">
                              {slot.status !== "booked" && slot.status !== "cancelled" && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => { setEditingSlotId(editingSlotId === slot.id ? null : slot.id); setEditSlot({ date: slot.date, startTime: slot.startTime, endTime: slot.endTime, coachNote: slot.coachNote ?? "" }); }}
                                    className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs">Edit</Button>
                                  <Button size="sm" variant="outline" onClick={() => cancelSlot(slot.id)}
                                    className="border-red-500/30 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 text-xs">Cancel</Button>
                                </>
                              )}
                              {slot.status === "cancelled" && (
                                <Button size="sm" variant="outline" onClick={() => deleteSlot(slot.id)}
                                  className="border-white/10 text-white/30 hover:text-red-400 text-xs">Delete</Button>
                              )}
                            </div>
                          </div>
                          {editingSlotId === slot.id && (
                            <div className="mt-4 pt-4 border-t border-white/10">
                              <div className="grid grid-cols-3 gap-3 mb-3">
                                <div>
                                  <label className="text-white/40 text-xs block mb-1">Date</label>
                                  <Input type="date" value={editSlot.date ?? ""} onChange={e => setEditSlot(p => ({ ...p, date: e.target.value }))}
                                    className="bg-white/5 border-white/10 text-white h-8 text-sm" />
                                </div>
                                <div>
                                  <label className="text-white/40 text-xs block mb-1">Start</label>
                                  <Input type="time" value={editSlot.startTime ?? ""} onChange={e => setEditSlot(p => ({ ...p, startTime: e.target.value }))}
                                    className="bg-white/5 border-white/10 text-white h-8 text-sm" />
                                </div>
                                <div>
                                  <label className="text-white/40 text-xs block mb-1">End</label>
                                  <Input type="time" value={editSlot.endTime ?? ""} onChange={e => setEditSlot(p => ({ ...p, endTime: e.target.value }))}
                                    className="bg-white/5 border-white/10 text-white h-8 text-sm" />
                                </div>
                              </div>
                              <div className="mb-3">
                                <Input placeholder="Note (optional)" value={editSlot.coachNote ?? ""} onChange={e => setEditSlot(p => ({ ...p, coachNote: e.target.value }))}
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-sm" />
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => updateSlot(slot.id)} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingSlotId(null)} className="text-white/40 text-xs">Cancel</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Bookings ── */}
              {irlSubTab === "bookings" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-white/40 text-sm">{bookings.filter(b => b.booking.status === "confirmed").length} confirmed</div>
                    <Button size="sm" onClick={() => setShowManualBook(!showManualBook)} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">
                      + Manual booking
                    </Button>
                  </div>

                  {showManualBook && (
                    <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                      <h3 className="text-sm font-medium mb-4">Create manual booking</h3>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <label className="text-white/40 text-xs block mb-1">Slot</label>
                          <select value={manualBookSlot} onChange={e => setManualBookSlot(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 h-9 text-sm">
                            <option value="">Select slot…</option>
                            {openSlots.map(s => (
                              <option key={s.id} value={s.id}>
                                {new Date(s.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} {s.startTime} – {s.endTime}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-white/40 text-xs block mb-1">Athlete</label>
                          <select value={manualBookClient} onChange={e => setManualBookClient(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 h-9 text-sm">
                            <option value="">Select athlete…</option>
                            {irlClients.map(a => (
                              <option key={a.clientId} value={a.clientId}>{a.clientName}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={createManualBooking} className="bg-white text-[#0a0a0a] hover:bg-white/90 text-xs">Book</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowManualBook(false)} className="text-white/40 text-xs">Cancel</Button>
                      </div>
                    </div>
                  )}

                  {bookingsLoading ? <div className="text-white/30 text-sm">Loading…</div> : (
                    <div className="space-y-2">
                      {bookings.length === 0 && <div className="text-white/30 text-sm py-8 text-center">No bookings yet</div>}
                      {bookings.map(({ booking, slot, client }) => (
                        <div key={booking.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{client?.name ?? "Unknown"}</span>
                                <BookingStatusBadge status={booking.status} />
                                {booking.creditRefunded && <span className="text-xs text-emerald-400/70">refunded</span>}
                              </div>
                              {slot && (
                                <div className="text-white/40 text-xs mt-0.5">
                                  {new Date(slot.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {slot.startTime} – {slot.endTime}
                                </div>
                              )}
                              <div className="text-white/30 text-xs mt-0.5">
                                Booked {new Date(booking.createdAt).toLocaleDateString("en-GB")} · {booking.creditsUsed} credit{booking.creditsUsed !== 1 ? "s" : ""}
                              </div>
                            </div>
                            {booking.status === "confirmed" && (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => markBookingStatus(booking.id, "completed")}
                                  className="border-emerald-500/30 text-emerald-400/70 hover:text-emerald-400 text-xs">
                                  Complete
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => markBookingStatus(booking.id, "no_show")}
                                  className="border-white/20 text-white/50 hover:text-white text-xs">
                                  No-show
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => setExpandedBookingId(expandedBookingId === booking.id ? null : booking.id)}
                                  className="border-red-500/30 text-red-400/70 hover:text-red-400 text-xs">
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </div>
                          {expandedBookingId === booking.id && booking.status === "confirmed" && (
                            <div className="mt-4 pt-4 border-t border-white/10">
                              <p className="text-white/50 text-sm mb-3">Cancel this booking:</p>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => cancelBooking(booking.id, true)}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
                                  Cancel + refund credit
                                </Button>
                                <Button size="sm" onClick={() => cancelBooking(booking.id, false)}
                                  className="bg-red-600 hover:bg-red-500 text-white text-xs">
                                  Cancel, no refund
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setExpandedBookingId(null)} className="text-white/40 text-xs">
                                  Keep
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Content / Brain ──────────────────────────────────────────── */}
          {nav === "content" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">Brain / Content</h1>
                <p className="text-white/40 text-sm mt-1">Programme templates, resources, and reference materials</p>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <div className="text-sm font-medium mb-1">Programme Templates</div>
                  <div className="text-white/40 text-xs">Upload training block templates and programme structures for use in programme generation</div>
                  <div className="mt-4 border-2 border-dashed border-white/10 rounded-lg p-6 text-center text-white/20 text-xs">Coming soon</div>
                </div>
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <div className="text-sm font-medium mb-1">Resources</div>
                  <div className="text-white/40 text-xs">Upload ebooks, PDFs, guides, and reference material for athletes</div>
                  <div className="mt-4 border-2 border-dashed border-white/10 rounded-lg p-6 text-center text-white/20 text-xs">Coming soon</div>
                </div>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                <div className="text-sm font-medium mb-3">Content Library</div>
                <div className="text-white/30 text-sm py-6 text-center">No content uploaded yet</div>
              </div>
            </div>
          )}

          {/* ── Billing ──────────────────────────────────────────────────── */}
          {nav === "billing" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">Billing</h1>
                <p className="text-white/40 text-sm mt-1">Subscription management and payment processing</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-8 text-center">
                <div className="text-white/20 text-4xl mb-3">₤</div>
                <div className="text-white/50 font-medium">Billing not yet configured</div>
                <p className="text-white/30 text-sm mt-2 max-w-sm mx-auto">
                  This section will support subscriptions, athlete billing, and payment history. The structure is in place and ready to build when needed.
                </p>
              </div>
            </div>
          )}

          {/* ── Audit Log ────────────────────────────────────────────────── */}
          {nav === "audit" && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">Audit Log</h1>
                <p className="text-white/40 text-sm mt-1">Track important platform events and changes</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-8 text-center">
                <div className="text-white/20 text-4xl mb-3">📋</div>
                <div className="text-white/50 font-medium">Audit logging not yet active</div>
                <p className="text-white/30 text-sm mt-2 max-w-sm mx-auto">
                  This section will log account changes, programme edits, and admin actions. The section is reserved and ready to build when needed.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
