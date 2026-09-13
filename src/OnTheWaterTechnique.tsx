import TechniquePage from './TechniquePage'

const content = `
## Fixed Seat Rowing Technique


### SCRA Fixed-Seat Rowing Technique - Introduction (1/6)

https://www.youtube.com/watch?v=217r_ondpr8

### SCRA Fixed-Seat Rowing Technique - Personal Set Up (2/6)

https://www.youtube.com/watch?v=bNHa3I_92s8

### SCRA Fixed-Seat Rowing Technique - The Catch (3/6)

https://www.youtube.com/watch?v=9Ri-GFyPYgU

### SCRA Fixed-Seat Rowing Technique - The Drive (4/6)

https://www.youtube.com/watch?v=IlS1SMxdAgs

### SCRA Fixed-Seat Rowing Technique - The Recovery (5/6)

https://www.youtube.com/watch?v=V8SVD3mlgrU

### SCRA Fixed-Seat Rowing Technique - Handy Pointers (6/6)

https://www.youtube.com/watch?v=GkqHluJ-Ik8

`

export default function OnTheWaterTechnique() {
  return <TechniquePage title="On The Water Technique" content={content} />
}
