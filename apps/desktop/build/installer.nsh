; Mezan — Windows inbound firewall rule for the local-network (multi-till) socket.
;
; WHY THIS FILE EXISTS. docs/INSTALL.md §7A.3 names the Windows firewall as the
; single most likely reason a till cannot reach its host, and nothing in the
; product created a rule or probed for one: the host started, bound 4173, logged
; a healthy line, and every till timed out. The consultant's only recourse was
; wf.msc on a shop PC, over the phone, in Arabic.
;
; SCOPED TO PRIVATE AND DOMAIN PROFILES ONLY. The books must never be published
; on a public network — a shop laptop tethered to a phone, or on a hotel or
; airport wifi. `profile=private,domain` is what keeps this rule from doing
; that; the host's own subnet check (main/lan-host.ts) refuses off-subnet
; callers regardless, but a firewall rule that opened the public profile would
; put the socket on the air before that check ever ran.
;
; Failures are IGNORED on purpose. `netsh` needs elevation, and an install
; running without it must still complete — a shop that cannot use multi-till is
; a support call; an installer that aborts halfway is a broken machine. The
; «اختبر الوصول» button on the connected-devices screen is what tells the
; operator the rule is missing.

!macro customInstall
  DetailPrint "Allowing Mezan through the Windows firewall on private networks…"
  ; Remove first so a reinstall does not accumulate duplicate rules under the
  ; same name; a missing rule makes this a no-op.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mezan (local network)"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mezan (local network)" dir=in action=allow protocol=TCP localport=4173 profile=private,domain description="Mezan multi-till: lets other tills on this shop network reach the main machine."'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mezan (local network)"'
  Pop $0
!macroend
