# About in the Poorup shell

Accepted direction: the user approved the researched proposal and requested implementation on 14 October 2026.

About is a regular app view reached through the existing footer link, with a secondary entry in the home Settings menu. It keeps the six primary navigation destinations, shared profile identity, audio controls, theme, and connection. Opening it must not reload the document or leave a room. A return control restores the previous view; browser Back and Forward must work.

The public `/about` route renders the same content and shell. Its information, native FAQ, links to Play and Rules, canonical metadata, and policy-gated structured data remain available without JavaScript. One shared content renderer supplies both the in-app view and server response.

Use the existing pixel-parlor fonts, colors, borders, and spacing. Present a modest About Poorup heading, an internally scrolling reading panel, and compact section links. Cover overview, purpose and distinguishing features, credits and useful links, and all eight existing FAQs. Retain the existing explanations and brand-independence wording. Describe documented product goals; do not invent founder history, teams, usage statistics, or asset authorship.

No document/body scrolling. Content must remain reachable at desktop, landscape iPad, phone, and 200% reflow. Native links and FAQ must work by keyboard. Themes, reduced motion, and forced colors use the existing application owners.

Preserve all unrelated dirty work and the protected operational note. Implement in the current development checkout; no commit, push, or publication is part of this request.
