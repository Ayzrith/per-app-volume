# Uygulama Ses Karıştırıcısı (per-app-volume)

GNOME Shell üst panelinde oturan, **o an ses çalan her uygulamanın sesini ayrı ayrı** ayarlamanı sağlayan eklenti.

En üstte ana sistem sesi, altında her uygulama için bir satır:
uygulama simgesi + adı, ses kaydırıcısı, yüzde, sessize alma düğmesi.

![GNOME 45–50](https://img.shields.io/badge/GNOME-45--50-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

## Özellikler

- Uygulama başına ses kaydırıcısı + sessize alma
- Aynı uygulamanın birden çok akışı tek satırda gruplanır
  (örn. Wine/Proton oyunlarının `audio stream #1` + `#17` akışları)
- Wine `.exe` adlarını düzeltir (`GenshinImpact.exe` → `Genshin Impact`)
- Flatpak portal bilgisinden gerçek simge + ad
  (`pactl` üzerinden `pipewire.access.portal.app_id` eşleşmesi)
- **Sadece gerçek uygulamalar:** sistem servisleri ve sanal düğümler gizlenir
  - `speech-dispatcher-dummy`, EasyEffects `effect_output.soft` / `Soft EQ`,
    `filter-chain`, yankı/gürültü engelleme, PipeWire/WirePlumber düğümleri
  - Sanal/pasif düğümler (`node.virtual`, `node.passive`) pactl üzerinden elenir
- Menü her açıldığında liste tazelenir
- Alt kısımda: listeyi yenile + ses ayarlarını aç

## Kurulum

GNOME 45–50 gerekir. Kopyala-yapıştır:

```bash
git clone https://github.com/Ayzrith/per-app-volume.git
cd per-app-volume
make install
```

Sonra çıkıp tekrar giriş yap (Wayland'da sıcak yükleme yok), ardından:

```bash
gnome-extensions enable per-app-volume@gnome-shell-extensions
```

### Kaldırma

```bash
cd per-app-volume
make uninstall
```

### Elle kurulum

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/per-app-volume@gnome-shell-extensions
cp extension.js metadata.json stylesheet.css ~/.local/share/gnome-shell/extensions/per-app-volume@gnome-shell-extensions/
# çıkış/giriş yap, sonra:
gnome-extensions enable per-app-volume@gnome-shell-extensions
```

## Dosyalar

| Dosya | Açıklama |
|---|---|
| `extension.js` | Eklenti mantığı (Gvc.MixerControl + pactl portal/filtre) |
| `metadata.json` | Eklenti bilgisi (GNOME 45–50) |
| `stylesheet.css` | Menü stilleri |

## Nasıl çalışıyor?

1. `Gvc.MixerControl` ile PipeWire sink-input'ları izlenir.
2. Gvc tarafı kaba filtre: `is_event_stream`, boş ad+kimlik, bilinen sistem adları.
3. `pactl -f json list sink-inputs` ile derin filtre:
   `node.virtual`/`node.passive`, sistem binary'leri (`sd_dummy` vb.),
   `application.name` kara listesi.
4. Aynı `(appId, ad)` akışları tek satırda gruplanır; kaydırıcı/sessiz hepsine uygulanır.
5. Portal `app_id` varsa satır gerçek simge + adla güncellenir.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
