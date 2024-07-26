from haystack_integrations.components.generators.ollama import OllamaGenerator
import pickle
from gradio_client import Client

SYSTEM_PROMPT = """Given the below short chapter of a story, \
        generate the next short chapter. No more than 5 lines. \
        Make it very short and concise but also interesting and creative. \
        Short Chapter:"""

def generate_text_story(text_seed,
                        img_style):

    story_seed = f"""{SYSTEM_PROMPT} {text_seed} \n- The ambient of the story follows this style: {img_style}"""

    llm = OllamaGenerator(model='phi3',
                          generation_kwargs={
                              "num_predict": 150,
                              "temperature": 0.9},
                          #streaming_callback=lambda chunk: save_model_response_to_disk(chunk.content)
                          )
    response = llm.run(story_seed)
    result = response['replies'][0]
    result = result.replace("assistant", "").replace("Here's a possible next chapter:", "")
    return result

def generate_text_story_legacy__(text_seed):

    story_seed = f"""{SYSTEM_PROMPT} {text_seed}"""

    client = Client("ysharma/Chat_with_Meta_llama3_8b")
    result = client.predict(
            message=story_seed,
            request=0.95,
            param_3=512,
            api_name="/chat"
    )

    result = result.replace("assistant", "").replace("Here's a possible next chapter:", "")

    return result

def save_model_response_to_disk(response):
    with open('temp_data/story_response.pkl', 'wb') as f:
        pickle.dump(response, f, pickle.HIGHEST_PROTOCOL)

if __name__ == "__main__":
    from gradio_client import Client

    client = Client("ysharma/Chat_with_Meta_llama3_8b")
    result = client.predict(
            message="Hello!!",
            request=0.95,
            param_3=512,
            api_name="/chat"
    )
    print(result)