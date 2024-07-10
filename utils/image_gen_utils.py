from gradio_client import Client
import os
import shutil
import random
import string

def generate_random_filename(length=8):
    characters = string.ascii_letters + string.digits
    filename = ''.join(random.choice(characters) for _ in range(length))
    return filename

def generate_image(prompt,
                   img_style):
    
    prompt = prompt + " In the style of " + img_style
    print(f"Calling model with prompt: {prompt}")

    try:
        client = Client("stabilityai/stable-diffusion-3-medium")
        result = client.predict(
            prompt=prompt,
            negative_prompt="",
            seed=0,
            randomize_seed=True,
            width=400,
            height=256,
            guidance_scale=5,
            num_inference_steps=120,
            api_name="/infer"
        )

        img_src = result[0].replace(os.sep, '/')

        # Generate random short name for image
        img_name = generate_random_filename() + ".png"
        relative_path = f"assets/{img_name}"

        # Copy image to assets folder and rename as 'output.png'
        shutil.copy(img_src, relative_path)

        # encoded_image = base64.b64encode(open(result[0], 'rb').read())
        # img_src = 'data:image/png;base64,{}'.format(encoded_image.decode())
    except Exception as e:
        print(f"Error: {e}")
        img_src = None
    result = None
    return img_src, relative_path

if __name__ == "__main__":
    prompt = "A dog in a forest."
    img_style = "Vincent Van Gogh painting"
    generate_image(prompt, img_style)



