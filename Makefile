UUID=per-app-volume@gnome-shell-extensions
DESTDIR=$(HOME)/.local/share/gnome-shell/extensions/$(UUID)

install:
	mkdir -p $(DESTDIR)
	cp extension.js metadata.json stylesheet.css $(DESTDIR)/

zip:
	gnome-extensions pack --force --out-dir=. --extra-sources=stylesheet.css extension.js metadata.json

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall:
	gnome-extensions disable $(UUID) || true
	rm -rf $(DESTDIR)
