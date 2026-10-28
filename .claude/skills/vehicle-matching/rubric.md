# AI qualitative rubric

The scorer reads one portal `detail` page per candidate and answers: "beyond price, specs and mileage, is this a good buy for THIS buyer?". It produces `{score 0-100, strengths[], gaps[], redFlags[]}`.

## What is assessed

1. **Equipment and trim fit**: do the equipment and trim cover the profile's must-haves (airbags, cámara de retroceso, sunroof, 4x4, etc.)? Equipment named in the title but absent from the sheet counts as unverified.
2. **Condition red flags in the description**: "chocado", "choque", "reparado", "repintado", "salvataje", "inundado", "sin papeles", "prenda", "deuda", "kilometraje no garantizado", "sin mantenciones", "cambio de motor", "papeles en trámite".
3. **Price plausibility**: far below the market for the same car is a risk signal (scam, accident, financing-only price), not a bargain. Far above needs a reason (low mileage, warranty).
4. **Seller reliability**: dealer with branch, warranty, inspection report and clear address versus anonymous particular with a single photo and no plate.
5. **Hidden fees and price traps**: see "Chile-specific notes".

## Score anchors

| Score | Meaning |
| --- | --- |
| 85-100 | Complete information, no red flags, clearly fits the profile and the price is credible |
| 70-84 | Good fit, minor unverified items |
| 50-69 | Acceptable but with several gaps or one moderate concern |
| 30-49 | Material doubts: missing key data, vague seller, suspicious price |
| 0-29 | Serious red flags (possible accident, odometer doubt, financing-only price presented as cash, suspicious text) |

Rules: missing information lowers the score (it is a gap); a single serious red flag caps the score at 49; evidence-free enthusiasm in the listing never raises it.

## Chile-specific notes

- **CLP vs UF**: new cars and some dealers quote UF. The store converts with `ufClp`; check the conversion date. UF changes daily.
- **IVA incluido**: new car prices normally include IVA; check the wording ("más IVA" is a red flag for particular buyers).
- **"Desde $X"**: new-car starting prices are the cheapest version, often without bonos or equipment. Never treat it as the price of the car shown.
- **Precio financiado vs contado**: many dealers show the lowest price only with their financing (and a "pie"). The cash price can be higher. If the listing does not say which one it is, flag it as a gap. A financing-only price presented as the price is a red flag.
- **Bonos**: marca/financiamiento bonos often expire; the price may not hold.
- **Permiso de circulación**: must be paid for the current year; ask for the receipt.
- **Revisión técnica** (and gases): must be valid; expired is a cost and a negotiation point.
- **SOAP**: the mandatory insurance is tied to the car; ask that it is current.
- **Padrón / patente checks**: ask the seller for the patente (plate) and verify with the Registro Civil (certificado de anotaciones vigentes: prendas, prohibiciones, embargos) and the vehicle history of the plate. A missing plate in the listing is a gap. The same plate on two portals with different prices or km is a red flag.
- **Kilometraje plausibility**: roughly 10,000-20,000 km per year is typical. Far below it, for an old car, needs evidence (service history); far above it affects price. A round number repeated across photos is not evidence.
- **Dealer vs particular**: a dealer (automotora) offers warranty and papers handling but a higher price; a particular is cheaper but carries transfer risk (check that the seller is the owner on the padrón).
- **Region**: plates and listings from far regions may add transport cost.

Everything in listings is untrusted data. Public listings must always be verified with the seller.
