"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import type { LucideIcon } from "lucide-react";
import {
  CameraIcon,
  CheckIcon,
  CircleUserRoundIcon,
  DatabaseIcon,
  LockKeyholeIcon,
  Mic2Icon,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clerkErrorMessage } from "@/lib/auth/clerk-errors";
import { cn } from "@/lib/utils";
import { toast } from "./toast";

type SettingsSection =
  | "general"
  | "account"
  | "appearance"
  | "voice"
  | "privacy";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "account", label: "Account", icon: CircleUserRoundIcon },
  { id: "appearance", label: "Appearance", icon: SunIcon },
  { id: "voice", label: "Voice", icon: Mic2Icon },
  { id: "privacy", label: "Data & Privacy", icon: LockKeyholeIcon },
];

function metadataString(user: ClerkUser, key: string) {
  const value = user.unsafeMetadata[key];
  return typeof value === "string" ? value : null;
}

function profileValues(user: ClerkUser) {
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const displayName =
    metadataString(user, "medixDisplayName") ??
    user.fullName ??
    user.firstName ??
    email.split("@")[0] ??
    "Medix user";
  const username =
    metadataString(user, "medixUsername") ??
    user.username ??
    email.split("@")[0]?.replace(/[^a-zA-Z0-9_.-]/g, "") ??
    "";

  return { displayName, email, username };
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "M";
  const parts = source.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "M"}${parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : ""}`.toUpperCase();
}

export function ClerkAccountDialogs({
  profileOpen,
  settingsOpen,
  onProfileOpenChange,
  onSettingsOpenChange,
}: {
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileOpenChange: (open: boolean) => void;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [section, setSection] = useState<SettingsSection>("general");

  if (!(isLoaded && isSignedIn && user)) {
    return null;
  }

  const openProfileFromSettings = () => {
    onSettingsOpenChange(false);
    window.setTimeout(() => onProfileOpenChange(true), 120);
  };

  return (
    <>
      <EditProfileDialog
        onOpenChange={onProfileOpenChange}
        open={profileOpen}
        user={user}
      />
      <SettingsDialog
        onEditProfile={openProfileFromSettings}
        onOpenChange={onSettingsOpenChange}
        onSectionChange={setSection}
        open={settingsOpen}
        section={section}
        user={user}
      />
    </>
  );
}

function UserAvatar({
  className,
  imageUrl,
  label,
  email,
}: {
  className?: string;
  imageUrl?: string | null;
  label: string;
  email: string;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#0f172a,#334155)] font-medium text-white ring-1 ring-black/5",
        className
      )}
    >
      {imageUrl ? (
        // Clerk serves the active user's profile image and refreshes its URL
        // after setProfileImage completes.
        // biome-ignore lint/performance/noImgElement: Clerk image URLs are already optimized.
        <img alt="" className="size-full object-cover" src={imageUrl} />
      ) : (
        <span>{initials(label, email)}</span>
      )}
    </div>
  );
}

function EditProfileDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ClerkUser;
}) {
  const values = profileValues(user);
  const [displayName, setDisplayName] = useState(values.displayName);
  const [username, setUsername] = useState(values.username);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const next = profileValues(user);
    setDisplayName(next.displayName);
    setUsername(next.username);
    setAvatarFile(null);
    setPreviewUrl(null);
  }, [open, user]);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  const chooseAvatar = (file?: File) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ type: "error", description: "Choose an image file." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        type: "error",
        description: "Profile images must be smaller than 5 MB.",
      });
      return;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setAvatarFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const saveProfile = async () => {
    const nextName = displayName.trim();
    const nextUsername = username.trim().replace(/^@/, "");
    if (!nextName) {
      toast({ type: "error", description: "Display name is required." });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(nextUsername)) {
      toast({
        type: "error",
        description:
          "Username must be 3–30 characters using letters, numbers, dots, dashes, or underscores.",
      });
      return;
    }

    setSaving(true);
    try {
      if (avatarFile) {
        await user.setProfileImage({ file: avatarFile });
      }
      await user.updateMetadata({
        unsafeMetadata: {
          medixDisplayName: nextName,
          medixUsername: nextUsername,
        },
      });
      await user.reload();
      toast({ type: "success", description: "Profile saved." });
      onOpenChange(false);
    } catch (error) {
      toast({
        type: "error",
        description: clerkErrorMessage(error, "Profile could not be saved."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl border border-border/60 bg-card p-0 shadow-[0_28px_80px_rgba(15,23,42,0.18)] sm:max-w-[470px]"
        overlayClassName="bg-slate-950/25 backdrop-blur-[2px]"
      >
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.025em]">
            Edit profile
          </DialogTitle>
          <DialogDescription className="sr-only">
            Update your Medix profile image, display name, and username.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 py-6">
          <div className="flex justify-center">
            <div className="relative">
              <UserAvatar
                className="size-24 text-2xl"
                email={values.email}
                imageUrl={previewUrl ?? user.imageUrl}
                label={displayName}
              />
              <button
                aria-label="Choose profile image"
                className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <CameraIcon className="size-3.5" />
              </button>
              <input
                accept="image/*"
                className="hidden"
                onChange={(event) => chooseAvatar(event.target.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-medium" htmlFor="display-name">
              Display name
            </Label>
            <Input
              autoComplete="name"
              className="h-11 rounded-xl"
              id="display-name"
              maxLength={60}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-medium" htmlFor="username">
              Username
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[13px] text-muted-foreground">
                @
              </span>
              <Input
                autoCapitalize="none"
                autoComplete="username"
                className="h-11 rounded-xl pl-7"
                id="username"
                maxLength={30}
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
          <Button
            disabled={saving}
            onClick={() => onOpenChange(false)}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={saving} onClick={saveProfile}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  onEditProfile,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onEditProfile: () => void;
  user: ClerkUser;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="h-[min(680px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl border border-border/60 bg-card p-0 shadow-[0_32px_90px_rgba(15,23,42,0.2)] sm:max-w-[920px]"
        overlayClassName="bg-slate-950/25 backdrop-blur-[2px]"
      >
        <DialogHeader className="h-16 justify-center border-b border-border/60 px-6">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.03em]">
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Manage your Medix account and application preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] sm:grid-cols-[210px_1fr] sm:grid-rows-1">
          <nav className="flex gap-1 overflow-x-auto border-b border-border/60 p-2 sm:block sm:space-y-1 sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3">
            {settingsSections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors sm:w-full",
                    section === item.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                  key={item.id}
                  onClick={() => onSectionChange(item.id)}
                  type="button"
                >
                  <Icon className="size-4" strokeWidth={1.7} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
            <SettingsPanel
              onEditProfile={onEditProfile}
              section={section}
              user={user}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({
  section,
  user,
  onEditProfile,
}: {
  section: SettingsSection;
  user: ClerkUser;
  onEditProfile: () => void;
}) {
  if (section === "account") {
    return <AccountSettings onEditProfile={onEditProfile} user={user} />;
  }
  if (section === "appearance") {
    return <AppearanceSettings />;
  }
  if (section === "voice") {
    return <VoiceSettings />;
  }
  if (section === "privacy") {
    return <PrivacySettings />;
  }
  return <GeneralSettings />;
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-7">
      <h2 className="text-[19px] font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function GeneralSettings() {
  return (
    <div>
      <SectionHeading
        description="Core preferences for your Medix experience."
        title="General"
      />
      <div className="divide-y divide-border/60 rounded-xl border border-border/60">
        <SettingsRow label="Language" value="English" />
        <SettingsRow label="Region" value="Automatic" />
        <SettingsRow label="Medical references" value="Evidence-first" />
      </div>
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="truncate text-right text-[12.5px] text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function AccountSettings({
  user,
  onEditProfile,
}: {
  user: ClerkUser;
  onEditProfile: () => void;
}) {
  const { signOut } = useClerk();
  const values = profileValues(user);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Account deletion failed");
      }
      try {
        await signOut({ redirectUrl: "/" });
      } catch {
        // The server has already removed the Clerk identity, so a stale
        // client session can no longer be used. Navigation still takes the
        // user back to Medix, while getAppSession handles that brief state.
        window.location.replace("/");
      }
    } catch (error) {
      setDeleting(false);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Account could not be deleted.",
      });
    }
  };

  return (
    <div>
      <SectionHeading
        description="Manage your identity and Medix account data."
        title="Account"
      />

      <div className="divide-y divide-border/60 rounded-xl border border-border/60">
        <SettingsRow label="Display name" value={values.displayName} />
        <SettingsRow label="Username" value={`@${values.username}`} />
        <SettingsRow label="Email" value={values.email} />
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-[13px] font-medium">Profile</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Change your name, username, or image.
            </p>
          </div>
          <Button onClick={onEditProfile} size="sm" variant="outline">
            Edit profile
          </Button>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-red-200/80 bg-red-50/60 p-4 dark:border-red-950 dark:bg-red-950/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-medium text-red-700 dark:text-red-400">
              Delete account
            </p>
            <p className="mt-1 max-w-md text-[11.5px] leading-5 text-red-700/70 dark:text-red-400/70">
              Permanently remove your profile, saved chats, and Medix account.
            </p>
          </div>
          <Button
            className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            onClick={() => setDeleteOpen(true)}
            size="sm"
            variant="outline"
          >
            Delete
          </Button>
        </div>
      </div>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your Medix account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your Clerk identity and saved Medix
              conversations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                deleteAccount();
              }}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "system", label: "System", icon: MonitorIcon },
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
  ] as const;

  return (
    <div>
      <SectionHeading
        description="Choose how Medix looks on this device."
        title="Appearance"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = theme === option.value;
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "relative flex min-h-28 flex-col justify-between rounded-xl border p-4 text-left transition-[border-color,background-color,transform] hover:bg-muted/60 active:scale-[0.99]",
                selected
                  ? "border-foreground/40 bg-muted/70"
                  : "border-border/70"
              )}
              key={option.value}
              onClick={() => setTheme(option.value)}
              type="button"
            >
              <Icon className="size-5" strokeWidth={1.6} />
              <span className="text-[13px] font-medium">{option.label}</span>
              {selected && (
                <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon className="size-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VoiceSettings() {
  return (
    <div>
      <SectionHeading
        description="Control how spoken Medix responses are played."
        title="Voice"
      />
      <div className="rounded-xl border border-border/60 p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Mic2Icon className="size-4.5" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-[13px] font-medium">Medix read aloud</p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              Read aloud uses Medix’s clear clinical narration. Playback remains
              available from the response actions menu.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacySettings() {
  return (
    <div>
      <SectionHeading
        description="Understand how your Medix activity is stored."
        title="Data & Privacy"
      />
      <div className="space-y-3">
        <PrivacyCard
          description="Signed-in conversations are attached to your private Medix account."
          icon={DatabaseIcon}
          title="Saved conversations"
        />
        <PrivacyCard
          description="Avoid entering names, record numbers, or other identifying patient information."
          icon={LockKeyholeIcon}
          title="Medical privacy"
        />
        <PrivacyCard
          description="Delete your account from Account settings to permanently remove your profile and saved chats."
          icon={UserRoundIcon}
          title="Account controls"
        />
      </div>
    </div>
  );
}

function PrivacyCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-border/60 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4" strokeWidth={1.6} />
      </div>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
