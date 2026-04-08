import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function authHeaders(token: string | null) {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

type NavItem = "users" | "athlete-linking" | "content" | "billing" | "audit";

interface User {
  id: number;
  email: string;
  roles: string[];
  clientId: number | null;
  status: "login_created" | "active";
  lastLoginAt: string | null;
  createdAt: string;
}

interface AthleteLink {
  clientId: number;
  clientName: string;
  loginEmail: string | null;
  userId: number | null;
  status: "no_login" | "login_created" | "active";
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

  // Athlete linking
  const [athletes, setAthletes] = useState<AthleteLink[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [athleteSearch, setAthleteSearch] = useState("");

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

  useEffect(() => { if (nav === "users") fetchUsers(); }, [nav]);
  useEffect(() => { if (nav === "athlete-linking") fetchAthletes(); }, [nav]);

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
    const body: any = {};
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

  const navItems: { id: NavItem; label: string }[] = [
    { id: "athlete-linking", label: "Athlete Accounts" },
    { id: "users", label: "All Users" },
    { id: "content", label: "Brain / Content" },
    { id: "billing", label: "Billing" },
    { id: "audit", label: "Audit Log" },
  ];

  const filteredAthletes = athletes.filter(a =>
    a.clientName.toLowerCase().includes(athleteSearch.toLowerCase()) ||
    (a.loginEmail ?? "").toLowerCase().includes(athleteSearch.toLowerCase())
  );

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
            onClick={() => setLocation("/coach")}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            Coach Dashboard
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
              <Input
                placeholder="Search athletes…"
                value={athleteSearch}
                onChange={e => setAthleteSearch(e.target.value)}
                className="mb-5 bg-white/5 border-white/10 text-white placeholder:text-white/20 max-w-sm"
              />
              {athletesLoading ? (
                <div className="text-white/30 text-sm">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {filteredAthletes.map(a => (
                    <div key={a.clientId} className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{a.clientName}</div>
                          <div className="text-white/40 text-sm mt-0.5">{a.loginEmail ?? "No login email"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded-md font-medium ${STATUS_COLOURS[a.status]}`}>
                            {STATUS_LABELS[a.status]}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setLinkingId(linkingId === a.clientId ? null : a.clientId); setLinkEmail(a.loginEmail ?? ""); setLinkPassword(""); }}
                            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs"
                          >
                            {a.userId ? "Edit" : "Create Login"}
                          </Button>
                        </div>
                      </div>
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
                <p className="text-white/40 text-sm mt-1">Manage accounts, roles, and passwords</p>
              </div>

              {/* Create user */}
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
                    onChange={e => setNewUserRole(e.target.value as any)}
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

              {usersLoading ? (
                <div className="text-white/30 text-sm">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{u.email}</span>
                            {u.roles.map(r => <RoleBadge key={r} role={r} />)}
                          </div>
                          <div className="text-white/30 text-xs mt-0.5">
                            {u.lastLoginAt ? `Last login ${new Date(u.lastLoginAt).toLocaleDateString()}` : "Never signed in"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-md font-medium ${STATUS_COLOURS[u.status]}`}>
                            {STATUS_LABELS[u.status]}
                          </span>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setEditingUser(editingUser?.id === u.id ? null : u); setEditRoles([...u.roles]); setResetPw(""); }}
                            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs"
                          >
                            Edit
                          </Button>
                        </div>
                      </div>
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
                  <div className="mt-4 border-2 border-dashed border-white/10 rounded-lg p-6 text-center text-white/20 text-xs">
                    Coming soon
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <div className="text-sm font-medium mb-1">Resources</div>
                  <div className="text-white/40 text-xs">Upload ebooks, PDFs, guides, and reference material for athletes</div>
                  <div className="mt-4 border-2 border-dashed border-white/10 rounded-lg p-6 text-center text-white/20 text-xs">
                    Coming soon
                  </div>
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
