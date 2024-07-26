import dash
from dash import html, dcc, callback, Input, Output, State, ALL
from dash.exceptions import PreventUpdate
import dash_bootstrap_components as dbc
import dash_daq as daq
import plotly.express as px
import plotly.graph_objects as go
import numpy as np
from PIL import Image
import time

from utils.llm_utils import generate_text_story
from utils.image_gen_utils import generate_image

dash.register_page(__name__)

layout = html.Div(
    [
        html.Div([

            html.Div([

                # Left Column
                html.Div([

                    # Input text
                    html.Div([
                        dcc.Textarea(id='input-text-seed',
                                     value="""I was travelling at the speed of light in the outer space and I started wondering. Are we living in a simulation?""",
                                     spellCheck='false')
                    ], className='row'),

                    # Output text story
                    html.Div([
                        html.Div(id='output-text-story')
                    ], className='row'),

                    # Img style
                    html.Div([
                        dcc.Dropdown(id='img-style-dropdown', options=['Vincent Van Gogh painting',
                                                                       'Pablo Picasso painting',
                                                                       'Futuristic',
                                                                       'Cartoonish',
                                                                       'Cyberpunk',
                                                                       'Psychedelic'],
                                                                       value='Futuristic')
                    ], className='row'),

                    # Button to generate
                    html.Div([
                        daq.ToggleSwitch(
                            id='generate-switch',
                            value=False
                        ),
                    ], className='row'),

                ], className='col-3'),

                # Output visual
                html.Div([
                    # html.Img(id='output-visual',
                    #          src=None)
                    html.Div(id='output-visual')
                ], className='col-9'),
                
            ], className='row'),

        ], className="container-fluid apply-padding", id='main-content'),

        dcc.Interval(
            id='interval-component',
            interval=60*1000, # in milliseconds
            n_intervals=0,
            disabled=True
        )

        # Storage components:
        # dcc.Store(id='store-new-image', data=''), # This is a dummy store to trigger the callback

    ]
)

# Callbacks --------------------------------------------------
    
# Callback for text story
@callback(
    Output('output-text-story', 'children'),
    State('output-text-story', 'children'),
    State('input-text-seed', 'value'),
    State('img-style-dropdown', 'value'),
    Input('generate-switch', 'value'),
    Input('interval-component', 'n_intervals')
)

def generate_text_story_(text_story_div,
                         text_seed,
                         img_style,
                         generate_switch,
                         n_intervals):
    
    if not generate_switch:
        raise PreventUpdate
    else:
        print('\nGenerating text story...')
        if text_story_div is None:
            text_gen_prompt = text_seed
        else:
            text_story = text_story_div['props']['children']
            text_gen_prompt = text_story

        print(f"Text seed: {text_gen_prompt}")
        output_text_story = generate_text_story(text_gen_prompt,
                                                img_style)
        
        output_text_story_div = html.Div(output_text_story,
                                         className='fade-in')

        return output_text_story_div
    
# Callback for image generation
@callback(
    Output('output-visual', 'children'),
    Output('main-content', 'style'),
    Output('interval-component', 'disabled'),
    Output('interval-component', 'interval'),
    Input('output-text-story', 'children'),
    Input('generate-switch', 'value'),
    Input('img-style-dropdown', 'value')
)
def generate_image_(text_story_div,
                    generate_switch,
                    img_style):
    
    if not generate_switch or text_story_div is None:
        raise PreventUpdate
    
    else:
        # Measure time of execution:
        text_story = text_story_div['props']['children']
        print(f"\nGenerating image with story: {text_story}...")
        start_time = time.time()
        img_path, img_relative_path = generate_image(text_story,
                                                     img_style)

        # Read the image and calculate average color:
        img = Image.open(img_path)
        img = img.resize((256, 256))
        img = np.array(img)

        avg_color = np.mean(img, axis=(0, 1))
        avg_color = 'rgb' + str(tuple(avg_color))

        median_color = np.median(img, axis=(0, 1))
        median_color = 'rgb' + str(tuple(median_color))

        min_color = np.min(img, axis=(0, 1))
        min_color = 'rgb' + str(tuple(min_color))

        max_color = np.max(img, axis=(0, 1))
        max_color = 'rgb' + str(tuple(max_color))

        img_gradient = f"linear-gradient(90deg, {min_color} 0%, {avg_color} 22%)"

        # Image styling:
        output_visual_div = html.Div([],
                                     className='fade-in',
                                     style={'background-image': f'url({img_relative_path})',
                                            'background-size': "100% 100%",
                                            'background-position': 'center',
                                            'background-repeat': 'no-repeat',
                                            'height': '99vh',
                                            'width': '102%',
                                            'border-radius': '10px',
                                            'box-shadow': f'inset 0px 0px 24px 24px {avg_color}'})
        
        # Background styling:
        bg_style = {'background': img_gradient,
                    'animation': 'gradient 15s ease infinite'}
        
        exec_time = time.time() - start_time
        print(f'\nImage generation execution time: {exec_time:.2f} seconds')
        intervals = (exec_time + 60) * 1000
    
        return output_visual_div, bg_style, False, intervals

