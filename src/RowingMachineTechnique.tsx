import TechniquePage from './TechniquePage'

const content = `
## Rowing Drills

### Pick Drill
Teaches the correct sequence of the recovery phase hands away->body pivot->bend legs. This sequence is as critical in a boat as on the machine, with the added complexity that for the boat to be efficient and fast, the whole crew must coordinate these movements together. When you are on the rowing machine in company, and rowing pieces at a fixed stroke rate take the opportunity to get into the same rythym as the rowers on the other machines - it will help to reinforce the need for crew rythym on the water.

https://youtu.be/-iRbfsCPXVE?si=58FGlT-Xy3ziqaXB

### Reverse Pick Drill

Teaches the correct sequence of the drive phase, legs->body->arms. This is critical on the rowing machine, but also on the water where we want to keep our back in the same strong position shown in the video, with our head in line with the spine (not throwing the head back to heave the oar)

https://youtu.be/MFbD8JuD9No?si=PiRmvxZ1hNqezLuF
`

export default function RowingMachineTechnique() {
  return <TechniquePage title="Rowing Machine Technique" content={content} />
}
