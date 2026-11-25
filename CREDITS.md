# Crédits des ressources (toutes en CC0 / domaine public)

Aucune de ces ressources n'impose de citation ; on les crédite quand même.

## Modèles 3D — Kay Lousberg (www.kaylousberg.com), licence CC0 1.0

- **KayKit : Adventurers Character Pack 1.0** : Chevalier, Barbare, Mage, Voleuse, Capuche (+ animations).
- **KayKit : Skeletons Character Pack 1.0** : Squelette guerrier, Squelette mage, Squelette voleur, Sbire squelette.
- **KayKit : Furniture Bits 1.0** : canapés, fauteuils, lits, meubles, lampes, tables, tapis, tableaux, cactus.
- **KayKit : Restaurant Bits 1.0** : frigos, comptoirs, éviers, tables de cuisine, chaises, cagettes.
- **KayKit : City Builder Bits 1.0** : voitures (berline, taxi, police, citadine, break), lampadaires, bancs, bennes, bouches à incendie, cartons, château d'eau.

## Personnages à taille humaine — Quaternius (quaternius.com), licence CC0 1.0

- **Grand gaillard** et **Voyageuse** : corps *Universal Base Characters*, tenues *Modular Character Outfits – Fantasy*,
  animations *Universal Animation Library* 1 et 2 — tous de Quaternius, CC0. Assemblage (un fichier par personnage)
  repris du dépôt public github.com/28thanujaya-hash/open-world-rpg-assets, lui aussi publié en CC0.
  Dans le jeu : `public/models/chars/q_homme.glb`, `q_femme.glb` (sans animations, maillage compressé) et
  `public/models/animsq.glb` (34 animations partagées).

Fichiers allégés (animations triées, armes d'origine retirées) dans `public/models/`.
Les armes, le planeur, la montgolfière, les constructions, les potions, la cruche, les grenades, les lamas, les largages
et le décor naturel sont faits en code (three.js).

## Bruitages

- **Armes, rechargements, explosion, roquette** : sons CC0 de freesound.org, rassemblés dans le projet GunLib (github.com/Deases/GunLib) :
  « AK-47 Assault Rifle being unloaded and reloaded » et « Inserting a rocket into an RPG-7… » (serøutōnin--deprivəd),
  « Machine gun and Rocket Assault » (waxsocks), « explosion2.wav » (IdkMrGarcia), « Shotgun reload sfx » (lumikon),
  « Sniper Fire.flac » (qubodup), « awp reload sound » (GFL7), « Magnum Research Desert Eagle » (areniporgen),
  « Desert Eagle Gunshot » (elliotlp), « Desert Eagle Reload [Air Soft] » (TheRichardGamer), « CLICK_47.wav » (Jaszunio15),
  « AK47 Shot » (LeMudCrab), « grenade sound effect » (MultiMax2121), « Heathers Gunshot Effect2 » (okieactor),
  « Air Rifle Unedited » (Fission9) — tous « Creative Commons 0 ».
  (Le seul son non-CC0 de ce projet, « Remington.wav », n'est **pas** utilisé.)
- **Pas, atterrissage, impacts, touches, éliminations, interface** : Kenney (www.kenney.nl) — Impact Sounds, Interface Sounds,
  RPG Audio, Digital Audio — licence CC0.
  Les nouveaux événements (grenade, largage, lama, dégâts et explosion des véhicules, pas des adversaires) réutilisent ces
  mêmes fichiers CC0 avec un volume ou une vitesse différents (voir `public/sfx/sons.json`).

## Musique

- **Musique du lobby** (`public/sfx/musique/lobby.mp3`) : boucle originale de 30 s (128 BPM) composée et synthétisée
  spécialement pour ce projet, sans aucun échantillon extérieur — libre d'utilisation (CC0). Remplaçable par la vôtre via
  `public/sfx/sons-perso.json` (voir `LISEZMOI.md`).

## Code

three.js (MIT) chargé depuis jsDelivr.
