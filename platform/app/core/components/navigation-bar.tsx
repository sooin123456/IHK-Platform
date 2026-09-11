import { MenuIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "./ui/button";
import ThemeSwitcher from "./theme-switcher";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

const publicLinks = [
  { to: "/news", label: "소식", variant: "ghost" as const },
  { to: "/download", label: "무료 다운로드", variant: "ghost" as const },
  {
    to: "/inquiry",
    label: "전문가에게 의뢰하기",
    variant: "outline" as const,
  },
  {
    to: "/workspace",
    label: "직접 작업하기",
    variant: "default" as const,
  },
  {
    to: "/auth/magic-link",
    label: "고객 로그인",
    variant: "ghost" as const,
  },
];

const authenticatedLinks = [
  {
    to: "/inquiry",
    label: "전문가에게 의뢰하기",
    variant: "outline" as const,
  },
  {
    to: "/workspace",
    label: "직접 작업하기",
    variant: "default" as const,
  },
  { to: "/notifications", label: "알림", variant: "ghost" as const },
  { to: "/logout", label: "로그아웃", variant: "ghost" as const },
];

export function NavigationMenuLinks({
  email,
  mobile = false,
}: {
  email?: string;
  mobile?: boolean;
}) {
  return (email ? authenticatedLinks : publicLinks).map((link) => {
    const button = (
      <Button asChild key={link.to} variant={link.variant}>
        <Link to={link.to}>{link.label}</Link>
      </Button>
    );
    return mobile ? (
      <SheetClose asChild key={link.to}>
        {button}
      </SheetClose>
    ) : (
      button
    );
  });
}

export function NavigationBar({
  email,
  loading,
}: {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  loading: boolean;
}) {
  return (
    <nav
      aria-label="주요 탐색"
      className="sticky top-0 z-50 border-b bg-background/90 px-5 text-foreground backdrop-blur-2xl md:px-10"
    >
      <div className="mx-auto flex h-18 max-w-[1320px] items-center justify-between">
        <Link
          className="flex items-center gap-2 font-bold tracking-tight"
          to="/"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[#3024d8] text-sm text-white">
            H
          </span>
          <span>한길시스템</span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            BIM 적산·물량산출
          </span>
        </Link>
        <div className="hidden items-center gap-1 lg:flex">
          {email ? (
            <span className="mr-2 max-w-48 truncate text-sm text-muted-foreground">
              {email}
            </span>
          ) : null}
          <ThemeSwitcher />
          <NavigationMenuLinks email={email} />
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <ThemeSwitcher />
          <Sheet>
            <SheetTrigger
              aria-label="메뉴 열기"
              className="grid size-11 place-items-center rounded-lg hover:bg-muted"
            >
              <MenuIcon className="size-5" />
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>
                  <Link to="/">한길시스템</Link>
                </SheetTitle>
                <SheetDescription>
                  직접 작업하거나 전문가에게 별도로 의뢰할 수 있습니다.
                </SheetDescription>
              </SheetHeader>
              <SheetFooter className="mt-8 grid gap-2">
                <NavigationMenuLinks email={email} mobile />
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
