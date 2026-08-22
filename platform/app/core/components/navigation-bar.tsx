import { MenuIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "./ui/button";
import ThemeSwitcher from "./theme-switcher";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
} from "./ui/sheet";

export function NavigationBar({
  email,
  loading,
}: {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  loading: boolean;
}) {
  const links = email
      ? [
        { to: "/workspace", label: "프로젝트" },
        { to: "/notifications", label: "알림" },
        { to: "/logout", label: "로그아웃" },
      ]
    : [
        { to: "/download", label: "무료 다운로드" },
        { to: "/auth/magic-link", label: "고객 로그인" },
      ];

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/90 px-5 text-foreground backdrop-blur-2xl md:px-10">
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
        <div className="hidden items-center gap-1 md:flex">
          {!email ? (
            <div className="mr-5 hidden items-center gap-1 lg:flex">
              <Button asChild variant="ghost">
                <a href="/#services">서비스</a>
              </Button>
              <Button asChild variant="ghost">
                <a href="/#deliverables">결과물</a>
              </Button>
              <Button asChild variant="ghost">
                <a href="/#approach">일하는 방식</a>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/news">소식</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/inquiry">문의</Link>
              </Button>
            </div>
          ) : null}
          {email ? (
            <span className="mr-2 max-w-48 truncate text-sm text-muted-foreground">
              {email}
            </span>
          ) : null}
          <ThemeSwitcher />
          {links.map((link, index) => (
            <Button
              asChild
              key={link.to}
              variant={index === links.length - 1 ? "default" : "ghost"}
            >
              <Link to={link.to}>{link.label}</Link>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 md:hidden">
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
                <Link className="font-semibold" to="/">
                  한길시스템
                </Link>
              </SheetHeader>
              <SheetFooter className="mt-8 grid gap-2">
                {!email ? (
                  <>
                    <SheetClose asChild>
                      <Button asChild variant="outline">
                        <Link to="/news">회사 소식</Link>
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button asChild variant="outline">
                        <Link to="/inquiry">문의하기</Link>
                      </Button>
                    </SheetClose>
                  </>
                ) : null}
                {links.map((link) => (
                  <SheetClose asChild key={link.to}>
                    <Button asChild variant="outline">
                      <Link to={link.to}>{link.label}</Link>
                    </Button>
                  </SheetClose>
                ))}
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
