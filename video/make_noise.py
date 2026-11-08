from PIL import Image
import random
random.seed(7)
size = 512
img = Image.new("L", (size, size))
px = img.load()
for y in range(size):
    for x in range(size):
        px[x, y] = random.randint(90, 166)
img.save("assets/noise.png")
print("noise ok")
